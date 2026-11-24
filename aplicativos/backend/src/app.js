
import express from "express";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { products, validateOrder } from "./catalog.js";

/**
 * Cria a aplicacao Express do KubeShop.
 *
 * Dependencias esperadas:
 * - config.version: versao da aplicacao.
 * - repository.ping(): verifica a conexao com o MongoDB.
 * - repository.list(): retorna os pedidos salvos.
 * - repository.create(order): salva um pedido e retorna o registro criado.
 *
 * O repository deve utilizar a conexao privada do MongoDB,
 * configurada fora deste arquivo, por variaveis de ambiente.
 */
export function createApp({
  config = { version: "1.0.0" },
  repository,
  logger = (entry) => console.log(JSON.stringify(entry)),
  state = {
    initialized: true,
    shuttingDown: false,
  },
} = {}) {
  if (!repository) {
    throw new Error(
      "O repositorio do MongoDB deve ser informado ao criar a aplicação."
    );
  }

  const app = express();

  // Reduz a exposicao de informacoes sobre o servidor.
  app.disable("x-powered-by");

  /**
   * Registra logs sem permitir que uma falha no logger
   * interrompa o funcionamento da API.
   *
   * Nao registrar corpo das requisicoes, senhas ou credenciais.
   */
  function writeLog(entry) {
    try {
      logger(entry);
    } catch {
      console.error("Nao foi possivel registrar o log da aplicacao.");
    }
  }

  /**
   * Identificacao das requisicoes e cabecalhos de seguranca.
   */
  app.use((req, res, next) => {
    const incomingId = req.get("x-request-id") || "";

    req.requestId = /^[a-zA-Z0-9._-]{1,64}$/.test(incomingId)
      ? incomingId
      : randomUUID();

    res.set({
      "X-Request-Id": req.requestId,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });

    const start = performance.now();

    res.on("finish", () => {
      const route =
        typeof req.route?.path === "string"
          ? req.route.path
          : "unmatched";

      // Evita registrar as consultas frequentes de saude.
      if (!route.startsWith("/api/health/")) {
        writeLog({
          level: "info",
          event: "http",
          requestId: req.requestId,
          method: req.method,
          route,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        });
      }
    });

    next();
  });

  /**
   * Recebe JSON com limite de 16 KB.
   */
  app.use(
    express.json({
      limit: "16kb",
      strict: true,
    })
  );

  /**
   * INFORMACOES DA API
   *
   * GET /api/info
   *
   * Retorna a versao e o horario da consulta.
   */
  app.get("/api/info", (_req, res) => {
    res.status(200).json({
      application: "KubeShop API",
      version: config.version,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * CATALOGO DE PRODUTOS
   *
   * GET /api/products
   *
   * O catalogo e definido pela aplicacao.
   * Nao e necessario consultar o MongoDB.
   */
  app.get("/api/products", (_req, res) => {
    res.status(200).json({
      products,
    });
  });

  /**
   * VERIFICACAO DE SAUDE - LIVENESS
   *
   * GET /api/health/live
   *
   * Verifica se o processo da API esta respondendo.
   * Nao depende da conexao com o banco.
   */
  app.get("/api/health/live", (_req, res) => {
    res.status(200).json({
      alive: true,
      application: "KubeShop API",
    });
  });

  /**
   * VERIFICACAO DE SAUDE - STARTUP
   *
   * GET /api/health/startup
   *
   * Verifica se a inicializacao da aplicacao foi concluida.
   */
  app.get("/api/health/startup", (_req, res) => {
    const initialized = Boolean(state.initialized);

    res.status(initialized ? 200 : 503).json({
      initialized,
    });
  });

  /**
   * VERIFICACAO DE SAUDE - READINESS
   *
   * GET /api/health/ready
   *
   * Verifica:
   * 1. Se a API terminou de inicializar.
   * 2. Se a aplicacao nao esta encerrando.
   * 3. Se o MongoDB responde pela conexao configurada.
   */
  app.get("/api/health/ready", async (_req, res) => {
    let database = false;

    try {
      database = Boolean(await repository.ping());
    } catch {
      database = false;
    }

    const ready = Boolean(
      database &&
      state.initialized &&
      !state.shuttingDown
    );

    res.status(ready ? 200 : 503).json({
      ready,
      database,
      initialized: Boolean(state.initialized),
      shuttingDown: Boolean(state.shuttingDown),
    });
  });

  /**
   * CONSULTA DO HISTORICO DE PEDIDOS
   *
   * GET /api/orders
   *
   * Busca os pedidos persistidos no MongoDB.
   * Caso o banco esteja indisponivel, retorna HTTP 503.
   */
  app.get("/api/orders", async (req, res, next) => {
    try {
      const orders = await repository.list();

      res.status(200).json({
        orders,
      });
    } catch (error) {
      error.statusCode = 503;
      next(error);
    }
  });

  /**
   * CRIAÇÃO DE PEDIDO FICTÍCIO
   *
   * POST /api/orders
   *
   * Fluxo:
   * 1. Recebe os dados enviados pelo frontend.
   * 2. Valida os produtos e as quantidades.
   * 3. Utiliza o resultado calculado por validateOrder.
   * 4. Acrescenta a data de criação.
   * 5. Persiste o pedido no MongoDB.
   * 6. Retorna HTTP 201.
   */
  app.post("/api/orders", async (req, res, next) => {
    let order;

    try {
      order = validateOrder(req.body);
    } catch (error) {
      return res.status(400).json({
        error: error.message || "Pedido inválido.",
        requestId: req.requestId,
      });
    }

    try {
      const created = await repository.create({
        ...order,
        createdAt: new Date().toISOString(),
      });

      return res.status(201).json({
        message: "Pedido criado com sucesso.",
        order: created,
      });
    } catch (error) {
      error.statusCode = 503;
      return next(error);
    }
  });

  /**
   * ROTA NÃO ENCONTRADA
   */
  app.use((req, res) => {
    res.status(404).json({
      error: "Rota não encontrada.",
      requestId: req.requestId,
    });
  });

  /**
   * TRATAMENTO CENTRALIZADO DE ERROS
   *
   * Não retorna mensagens internas do MongoDB,
   * caminhos do servidor ou informações de credenciais.
   */
  app.use((error, req, res, _next) => {
    if (res.headersSent) {
      return;
    }

    let status = Number(error.statusCode) || 500;

    if (error.type === "entity.too.large") {
      status = 413;
    } else if (
      error instanceof SyntaxError &&
      "body" in error
    ) {
      status = 400;
    }

    const messages = {
      400: "JSON inválido.",
      413: "Corpo da requisição muito grande.",
      503: "Serviço temporariamente indisponível.",
      500: "Erro interno do servidor.",
    };

    writeLog({
      level: "error",
      event: "request_failed",
      requestId: req.requestId,
      method: req.method,
      status,
      errorType: error.name || "Error",
    });

    res.status(status).json({
      error: messages[status] || messages[500],
      requestId: req.requestId,
    });
  });

  return {
    app,
    state,
  };
}
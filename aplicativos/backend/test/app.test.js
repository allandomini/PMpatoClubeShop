
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";

import { tmpdir } from "node:os";
import path from "node:path";

import {
  test,
  before,
  after,
} from "node:test";

import assert from "node:assert/strict";

import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";

// Variáveis utilizadas pelos testes.
let server;
let base;

// Simula os pedidos armazenados pelo repositório.
const rows = [];

// Simula a disponibilidade do MongoDB.
let database = true;

// Estado compartilhado com a aplicação.
const state = {
  initialized: true,
  shuttingDown: false,
};

// Inicializa o servidor de testes antes dos testes individuais.
before(async () => {
  // Repositório falso para não depender de um MongoDB real.
  const repository = {
    async ping() {
      if (!database) {
        throw new Error("offline");
      }

      return true;
    },

    async create(order) {
      if (!database) {
        throw new Error("offline");
      }

      const row = {
        ...order,
        id: String(rows.length + 1),
      };

      rows.push(row);

      return row;
    },

    async list() {
      if (!database) {
        throw new Error("offline");
      }

      return [...rows];
    },
  };

  // Cria a aplicação utilizando configurações de teste.
  const { app } = createApp({
    config: readConfig({}),
    repository,
    logger: () => {},
    state,
  });

  // Utiliza uma porta dinâmica para evitar conflitos.
  server = app.listen(0, "127.0.0.1");

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  base = `http://127.0.0.1:${server.address().port}`;
});

// Encerra o servidor depois da execução dos testes.
after(async () => {
  if (!server) {
    return;
  }

  server.closeAllConnections();

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

// --------------------------------------------------
// TESTE 1 - CATÁLOGO DE PRODUTOS
// --------------------------------------------------

test(
  "catálogo retorna os produtos definidos na API e propaga request-id",
  async () => {
    const response = await fetch(`${base}/api/products`, {
      headers: {
        "x-request-id": "pm04-teste-1",
      },
    });

    assert.equal(response.status, 200);

    assert.equal(
      response.headers.get("x-request-id"),
      "pm04-teste-1",
    );

    const { products } = await response.json();

    assert.equal(products.length, 6);

    assert.equal(products[0].id, "headphones");

    assert.ok(
      products.every((product) => product.priceCents > 0),
    );
  },
);

// --------------------------------------------------
// TESTE 2 - CRIAÇÃO E CONSULTA DE PEDIDOS
// --------------------------------------------------

test(
  "cria e consulta pedidos, utilizando os preços definidos pelo servidor",
  async () => {
    const response = await fetch(`${base}/api/orders`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        items: [
          {
            productId: "headphones",
            quantity: 2,
          },
        ],

        // Valor adulterado propositalmente.
        // A API deve ignorar esse valor.
        totalCents: 1,
      }),
    });

    assert.equal(response.status, 201);

    const { order } = await response.json();

    assert.equal(order.totalCents, 37980);

    assert.equal(order.fictional, true);

    assert.equal(order.status, "confirmed");

    assert.ok(order.id);

    // Consulta o histórico de pedidos.
    const historyResponse = await fetch(
      `${base}/api/orders`,
    );

    assert.equal(historyResponse.status, 200);

    const { orders } = await historyResponse.json();

    assert.ok(Array.isArray(orders));

    assert.equal(orders[0].id, order.id);

    assert.equal(orders[0].totalCents, 37980);
  },
);

// --------------------------------------------------
// TESTE 3 - VALIDAÇÃO DOS PEDIDOS
// --------------------------------------------------

test(
  "rejeita pedidos inválidos, produtos inexistentes e quantidades incorretas",
  async () => {
    const invalidOrders = [
      {},
      { items: [] },
      { items: [null] },

      {
        items: [
          {
            productId: "produto-inexistente",
            quantity: 1,
          },
        ],
      },

      {
        items: [
          {
            productId: "mouse",
            quantity: 1.5,
          },
        ],
      },

      {
        items: [
          {
            productId: "mouse",
            quantity: 0,
          },
        ],
      },

      {
        items: [
          {
            productId: "mouse",
            quantity: 11,
          },
        ],
      },

      {
        items: [
          {
            productId: "mouse",
            quantity: 1,
          },
          {
            productId: "mouse",
            quantity: 1,
          },
        ],
      },
    ];

    for (const body of invalidOrders) {
      const response = await fetch(
        `${base}/api/orders`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify(body),
        },
      );

      assert.equal(
        response.status,
        400,
        `Pedido inválido deveria retornar 400: ${JSON.stringify(body)}`,
      );
    }

    // Testa JSON malformado.
    const malformedResponse = await fetch(
      `${base}/api/orders`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: "{",
      },
    );

    assert.equal(malformedResponse.status, 400);
  },
);

// --------------------------------------------------
// TESTE 4 - DISPONIBILIDADE DO BANCO DE DADOS
// --------------------------------------------------

test(
  "banco indisponível não altera liveness e bloqueia readiness e histórico",
  async () => {
    database = false;

    try {
      // O processo continua ativo.
      const liveResponse = await fetch(
        `${base}/api/health/live`,
      );

      assert.equal(liveResponse.status, 200);

      // A aplicação não está pronta para utilizar o banco.
      const readyResponse = await fetch(
        `${base}/api/health/ready`,
      );

      assert.equal(readyResponse.status, 503);

      // A consulta do histórico depende do banco.
      const ordersResponse = await fetch(
        `${base}/api/orders`,
      );

      assert.equal(ordersResponse.status, 503);

      const error = await ordersResponse.json();

      assert.equal(
        error.error,
        "Serviço temporariamente indisponível.",
      );

    } finally {
      // Restaura a disponibilidade para os próximos testes.
      database = true;
    }
  },
);

// --------------------------------------------------
// TESTE 5 - INICIALIZAÇÃO E DESLIGAMENTO
// --------------------------------------------------

test(
  "inicialização e desligamento controlam a prontidão da aplicação",
  async () => {
    // Simula a aplicação ainda inicializando.
    state.initialized = false;

    const startupResponse = await fetch(
      `${base}/api/health/startup`,
    );

    assert.equal(startupResponse.status, 503);

    const readyDuringStartup = await fetch(
      `${base}/api/health/ready`,
    );

    assert.equal(readyDuringStartup.status, 503);

    // Simula a inicialização concluída.
    state.initialized = true;

    // Simula o desligamento do serviço.
    state.shuttingDown = true;

    const readyDuringShutdown = await fetch(
      `${base}/api/health/ready`,
    );

    assert.equal(readyDuringShutdown.status, 503);

    // A aplicação ainda está ativa durante o desligamento.
    const liveDuringShutdown = await fetch(
      `${base}/api/health/live`,
    );

    assert.equal(liveDuringShutdown.status, 200);

    // Restaura o estado normal.
    state.shuttingDown = false;

    const readyAfterStartup = await fetch(
      `${base}/api/health/ready`,
    );

    assert.equal(readyAfterStartup.status, 200);
  },
);

// --------------------------------------------------
// TESTE 6 - INFORMAÇÕES DA API
// --------------------------------------------------

test(
  "endpoint de informações retorna versão e timestamp",
  async () => {
    const response = await fetch(
      `${base}/api/info`,
    );

    assert.equal(response.status, 200);

    const info = await response.json();

    assert.equal(info.version, "1.0.0");

    assert.ok(info.timestamp);

    // Não deve depender de metadados de Kubernetes.
    assert.equal(info.podName, undefined);

    assert.equal(info.labMode, undefined);
  },
);

// --------------------------------------------------
// TESTE 7 - ROTAS NÃO IMPLEMENTADAS
// --------------------------------------------------

test(
  "rotas de métricas e laboratório não fazem parte da aplicação",
  async () => {
    const routes = [
      "/api/metrics",
      "/api/lab/cpu",
      "/nao-existe/123",
    ];

    for (const route of routes) {
      const response = await fetch(
        `${base}${route}`,
      );

      assert.equal(response.status, 404);
    }
  },
);

// --------------------------------------------------
// TESTE 8 - VALIDAÇÃO DAS CONFIGURAÇÕES
// --------------------------------------------------

test(
  "configuração valida credenciais e limites de portas",
  () => {
    // Usuário sem senha.
    assert.throws(
      () =>
        readConfig({
          MONGO_USERNAME: "demo",
        }),

      /juntos/,
    );

    // Porta fora do intervalo permitido.
    assert.throws(
      () =>
        readConfig({
          PORT: "70000",
        }),

      /inválido/,
    );

    // Caracteres especiais devem ser codificados na URI.
    const config = readConfig({
      MONGO_USERNAME: "u@",
      MONGO_PASSWORD: "p#",
    });

    assert.match(
      config.mongoUri,
      /u%40:p%23@/,
    );
  },
);

// --------------------------------------------------
// TESTE 9 - DOCKER SECRETS
// --------------------------------------------------

test(
  "lê Docker Secret e rejeita arquivos vazios ou configurações ambíguas",
  () => {
    const directory = mkdtempSync(
      path.join(
        tmpdir(),
        "kube-shop-secret-",
      ),
    );

    const file = path.join(
      directory,
      "password",
    );

    try {
      // Cria um arquivo temporário simulando um Docker Secret.
      writeFileSync(
        file,
        "p#@ss\n",
      );

      const config = readConfig({
        MONGO_USERNAME: "shop",
        MONGO_PASSWORD_FILE: file,
      });

      assert.match(
        config.mongoUri,
        /shop:p%23%40ss@/,
      );

      assert.match(
        config.mongoUri,
        /authSource=kubeshop/,
      );

      // Não permite informar senha direta e arquivo ao mesmo tempo.
      assert.throws(
        () =>
          readConfig({
            MONGO_USERNAME: "shop",
            MONGO_PASSWORD: "x",
            MONGO_PASSWORD_FILE: file,
          }),

        /apenas um/,
      );

      // Rejeita arquivo vazio.
      writeFileSync(file, "\n");

      assert.throws(
        () =>
          readConfig({
            MONGO_USERNAME: "shop",
            MONGO_PASSWORD_FILE: file,
          }),

        /vazio/,
      );

      // Rejeita arquivo inexistente.
      assert.throws(
        () =>
          readConfig({
            MONGO_USERNAME: "shop",
            MONGO_PASSWORD_FILE: path.join(
              directory,
              "missing",
            ),
          }),

        /Não foi possível ler/,
      );

    } finally {
      // Remove os arquivos temporários.
      rmSync(
        directory,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);
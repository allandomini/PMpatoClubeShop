
import { setTimeout as delay } from "node:timers/promises";

import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { MongoOrderRepository } from "./repository.js";

// Carrega as configurações da aplicação.
const config = readConfig();

// Cria o repositório responsável pela comunicação com o MongoDB.
const repository = new MongoOrderRepository(config);

// Estado compartilhado entre o servidor e a aplicação.
const state = {
  initialized: false,
  shuttingDown: false,
};

// Cria a aplicação Express.
const { app } = createApp({
  config,
  repository,
  state,
});

// Controla a tentativa atual de conexão com o banco.
let connectionAttempt = null;

// Impede que o processo de encerramento seja executado mais de uma vez.
let shutdownPromise = null;

// Inicia o servidor HTTP.
const server = app.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify({
      event: "listening",
      port: server.address().port,
      host: config.host,
      version: config.version,
    }),
  );
});

// Trata erros ocorridos na inicialização do servidor HTTP.
server.on("error", (error) => {
  console.error(
    JSON.stringify({
      event: "server_error",
      errorType: error.name,
    }),
  );

  process.exitCode = 1;
});

// Inicializa a conexão com o MongoDB.
// Enquanto o banco não estiver disponível, realiza novas tentativas.
async function initializeDatabase() {
  while (!state.shuttingDown && !state.initialized) {
    connectionAttempt = repository.connect();

    try {
      await connectionAttempt;

      // Evita marcar a aplicação como inicializada
      // caso o encerramento tenha sido solicitado durante a conexão.
      if (state.shuttingDown) {
        break;
      }

      state.initialized = true;

      console.log(
        JSON.stringify({
          event: "database_ready",
          database: config.database,
        }),
      );
    } catch (error) {
      if (state.shuttingDown) {
        break;
      }

      // Não registra mensagens completas de erro,
      // evitando a exposição acidental de informações sensíveis.
      console.error(
        JSON.stringify({
          event: "database_retry",
          errorType: error.name,
          retryInSeconds: 2,
        }),
      );
    } finally {
      connectionAttempt = null;
    }

    // Aguarda antes de tentar conectar novamente.
    if (!state.initialized && !state.shuttingDown) {
      await delay(2000);
    }
  }
}

// Encerra o servidor e libera os recursos utilizados.
async function shutdown() {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  state.shuttingDown = true;

  shutdownPromise = (async () => {
    console.log(
      JSON.stringify({
        event: "shutdown_started",
      }),
    );

    // Impede que o encerramento fique aguardando indefinidamente.
    const timeout = setTimeout(() => {
      console.error(
        JSON.stringify({
          event: "shutdown_timeout",
        }),
      );

      process.exit(1);
    }, 10000);

    try {
      // Aguarda uma eventual tentativa de conexão em andamento.
      if (connectionAttempt) {
        await connectionAttempt.catch(() => {});
      }

      // Para de aceitar novas conexões HTTP e aguarda
      // as requisições em andamento.
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      // Fecha a conexão com o MongoDB.
      await repository.close();

      clearTimeout(timeout);

      console.log(
        JSON.stringify({
          event: "shutdown_completed",
        }),
      );

      process.exitCode = 0;
    } catch (error) {
      clearTimeout(timeout);

      console.error(
        JSON.stringify({
          event: "shutdown_error",
          errorType: error.name,
        }),
      );

      process.exitCode = 1;
    }
  })();

  return shutdownPromise;
}

// Sinais utilizados pelo sistema operacional e pelos containers.
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Inicia o processo de conexão com o banco.
await initializeDatabase();
import { readFileSync } from "node:fs";

/**
 * KubeShop - Configuração da API
 *
 * Lê as configurações a partir de variáveis de ambiente.
 * Nenhuma credencial possui valor padrão no código.
 *
 * Variáveis suportadas:
 *
 * Servidor HTTP
 * - HOST                 Endereço de escuta (padrão: 0.0.0.0)
 * - PORT                 Porta da API (padrão: 3000)
 * - APP_VERSION          Versão exibida em /api/info (padrão: 1.0.0)
 *
 * MongoDB
 * - MONGO_HOST           Endereço do banco; em produção, o IP privado
 *                        da VM do MongoDB (padrão: localhost)
 * - MONGO_PORT           Porta do banco (padrão: 27017)
 * - MONGO_DATABASE       Nome do banco (padrão: kubeshop)
 * - MONGO_AUTH_SOURCE    Banco de autenticação (padrão: MONGO_DATABASE)
 * - MONGO_USERNAME       Usuário da aplicação
 * - MONGO_USERNAME_FILE  Arquivo com o usuário (Docker Secret)
 * - MONGO_PASSWORD       Senha da aplicação
 * - MONGO_PASSWORD_FILE  Arquivo com a senha (Docker Secret)
 *
 * Usuário e senha devem ser informados juntos. Para cada um deles,
 * use a variável direta ou a variante _FILE, nunca as duas.
 *
 * As mensagens de erro nunca incluem valores de credenciais.
 */

const DEFAULTS = Object.freeze({
  host: "0.0.0.0",
  port: 3000,
  version: "1.0.0",
  mongoHost: "localhost",
  mongoPort: 27017,
  database: "kubeshop",
});

/**
 * Cria um erro de configuração.
 */
function configError(message) {
  const error = new Error(message);
  error.name = "ConfigError";
  return error;
}

/**
 * Retorna o valor da variável sem espaços nas extremidades,
 * ou undefined quando ausente ou vazia.
 */
function readString(env, name) {
  const value = env[name];

  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = String(value).trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Converte e valida uma porta TCP (1 a 65535).
 */
function readPort(env, name, fallback) {
  const raw = readString(env, name);

  if (raw === undefined) {
    return fallback;
  }

  if (!/^\d+$/.test(raw)) {
    throw configError(`Valor inválido para ${name}: informe um número entre 1 e 65535`);
  }

  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configError(`Valor inválido para ${name}: informe um número entre 1 e 65535`);
  }

  return port;
}

/**
 * Lê um segredo pela variável direta ou pelo arquivo indicado
 * em <NAME>_FILE (formato usado por Docker Secrets).
 *
 * O conteúdo do arquivo nunca é incluído nas mensagens de erro.
 */
function readSecret(env, name) {
  const fileVariable = `${name}_FILE`;
  const direct = readString(env, name);
  const file = readString(env, fileVariable);

  if (direct !== undefined && file !== undefined) {
    throw configError(
      `Informe apenas um entre ${name} e ${fileVariable}`
    );
  }

  if (file === undefined) {
    return direct;
  }

  let content;

  try {
    content = readFileSync(file, "utf8");
  } catch {
    throw configError(
      `Não foi possível ler o arquivo indicado em ${fileVariable}`
    );
  }

  // Remove a quebra de linha final comum em arquivos de segredo.
  const value = content.replace(/\r?\n$/, "");

  if (value.trim().length === 0) {
    throw configError(
      `O arquivo indicado em ${fileVariable} está vazio`
    );
  }

  return value;
}

/**
 * Valida o endereço do MongoDB, impedindo caracteres que
 * alterariam a estrutura da URI de conexão.
 */
function readMongoHost(env) {
  const host = readString(env, "MONGO_HOST") ?? DEFAULTS.mongoHost;

  if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
    throw configError("Valor inválido para MONGO_HOST");
  }

  return host;
}

/**
 * Valida o nome de um banco de dados do MongoDB.
 */
function readDatabaseName(env, name, fallback) {
  const value = readString(env, name) ?? fallback;

  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(value)) {
    throw configError(`Valor inválido para ${name}`);
  }

  return value;
}

/**
 * Monta a configuração da aplicação.
 *
 * @param {Object} env Variáveis de ambiente (padrão: process.env).
 * @returns {Object} Configuração validada.
 */
export function readConfig(env = process.env) {
  const host = readString(env, "HOST") ?? DEFAULTS.host;
  const port = readPort(env, "PORT", DEFAULTS.port);
  const version = readString(env, "APP_VERSION") ?? DEFAULTS.version;

  const mongoHost = readMongoHost(env);
  const mongoPort = readPort(env, "MONGO_PORT", DEFAULTS.mongoPort);
  const database = readDatabaseName(env, "MONGO_DATABASE", DEFAULTS.database);
  const authSource = readDatabaseName(env, "MONGO_AUTH_SOURCE", database);

  const username = readSecret(env, "MONGO_USERNAME");
  const password = readSecret(env, "MONGO_PASSWORD");

  if ((username === undefined) !== (password === undefined)) {
    throw configError(
      "MONGO_USERNAME e MONGO_PASSWORD devem ser informados juntos"
    );
  }

  // Codifica as credenciais para aceitar caracteres especiais.
  const credentials =
    username !== undefined
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : "";

  const query =
    username !== undefined
      ? `?authSource=${encodeURIComponent(authSource)}`
      : "";

  const mongoUri =
    `mongodb://${credentials}${mongoHost}:${mongoPort}/${database}${query}`;

  return Object.freeze({
    host,
    port,
    version,
    database,
    mongoUri,
  });
}

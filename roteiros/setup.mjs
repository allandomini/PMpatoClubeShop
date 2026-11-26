#!/usr/bin/env node
/**
 * KubeShop - Preparação do ambiente local
 *
 * 1. Confere Node.js e Docker (com Compose).
 * 2. Cria o arquivo .env a partir do .env.exemplo, gerando
 *    senhas aleatórias (somente se o .env ainda não existir).
 * 3. Sobe os serviços com "docker compose up -d --build".
 * 4. Aguarda a loja responder em /api/health/ready.
 *
 * Uso:
 *   node roteiros/setup.mjs              prepara e sobe tudo
 *   node roteiros/setup.mjs --no-start   só cria o .env
 *   node roteiros/setup.mjs --timeout 300
 *
 * As senhas geradas nunca são impressas na tela.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");
const exampleFile = path.join(root, ".env.exemplo");

const args = process.argv.slice(2);
const noStart = args.includes("--no-start");
const timeoutIndex = args.indexOf("--timeout");
const timeoutSeconds =
  timeoutIndex >= 0 ? Number(args[timeoutIndex + 1]) : 240;

function step(message) {
  console.log(`\n▶ ${message}`);
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: root,
    stdio: options.quiet ? "pipe" : "inherit",
    encoding: "utf8",
    shell: false,
  });
}

// ----------------------------------------------------------
// 1. Pré-requisitos
// ----------------------------------------------------------
step("Conferindo pré-requisitos");

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 24 || (major === 24 && minor < 15)) {
  fail(`Node.js ${process.versions.node} encontrado; é necessário 24.15 ou superior.`);
}
console.log(`  Node.js ${process.versions.node} ✔`);

const compose = run("docker", ["compose", "version", "--short"], { quiet: true });
if (compose.status !== 0) {
  fail("Docker com o plugin Compose não foi encontrado. Instale o Docker Desktop ou o Docker Engine.");
}
console.log(`  Docker Compose ${compose.stdout.trim()} ✔`);

const daemon = run("docker", ["info", "--format", "{{.ServerVersion}}"], { quiet: true });
if (daemon.status !== 0) {
  fail("O Docker está instalado, mas o serviço não está em execução. Inicie o Docker e tente de novo.");
}
console.log(`  Docker Engine ${daemon.stdout.trim()} ✔`);

// ----------------------------------------------------------
// 2. Arquivo .env
// ----------------------------------------------------------
step("Preparando o arquivo .env");

const secret = () => randomBytes(24).toString("base64url");

if (existsSync(envFile)) {
  console.log("  .env já existe; mantido sem alterações.");
  console.log("  (Trocar senhas depois que o banco foi criado exige recriar o volume do MongoDB.)");
} else {
  if (!existsSync(exampleFile)) {
    fail(".env.exemplo não encontrado na raiz do repositório.");
  }

  const content = readFileSync(exampleFile, "utf8")
    .replace(/^MONGO_ROOT_PASSWORD=.*$/m, `MONGO_ROOT_PASSWORD=${secret()}`)
    .replace(/^MONGO_APP_PASSWORD=.*$/m, `MONGO_APP_PASSWORD=${secret()}`);

  writeFileSync(envFile, content, { mode: 0o600 });
  console.log("  .env criado com senhas aleatórias (não exibidas). ✔");
}

if (noStart) {
  console.log("\nPronto. Para subir os serviços: docker compose up -d --build");
  process.exit(0);
}

// ----------------------------------------------------------
// 3. Subida dos serviços
// ----------------------------------------------------------
step("Construindo as imagens e subindo os serviços");

const up = run("docker", ["compose", "up", "-d", "--build"]);
if (up.status !== 0) {
  fail("Falha no docker compose up. Veja as mensagens acima e rode: docker compose logs");
}

// ----------------------------------------------------------
// 4. Espera pela prontidão
// ----------------------------------------------------------
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const host = !env.KUBESHOP_BIND || env.KUBESHOP_BIND === "0.0.0.0" ? "localhost" : env.KUBESHOP_BIND;
const baseUrl = `http://${host}:${env.KUBESHOP_PORT || 8080}`;

step(`Aguardando a loja ficar pronta em ${baseUrl} (até ${timeoutSeconds}s)`);

const deadline = Date.now() + timeoutSeconds * 1000;
let ready = false;

while (Date.now() < deadline) {
  try {
    const response = await fetch(`${baseUrl}/api/health/ready`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // Serviço ainda subindo.
  }
  process.stdout.write(".");
  await delay(3000);
}

if (!ready) {
  fail(`A loja não ficou pronta em ${timeoutSeconds}s. Diagnóstico: docker compose ps && docker compose logs --tail=50`);
}

console.log(`\n\n✔ KubeShop no ar: ${baseUrl}`);
console.log("  Teste rápido:        npm run smoke");
console.log("  Teste no navegador:  npm run test:browser");
console.log("  Parar:               docker compose down");

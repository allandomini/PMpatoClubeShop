const fs = require("fs");

// ==========================================================
// HEALTH CHECK DO MONGODB - KUBESHOP
// ==========================================================

try {
  const username = process.env.MONGO_APP_USERNAME;
  const passwordFile = process.env.MONGO_APP_PASSWORD_FILE;

  // Verifica as variáveis obrigatórias
  if (!username || !passwordFile) {
    print("Health check: variáveis de autenticação ausentes.");
    quit(1);
  }

  // Verifica o arquivo de senha
  if (!fs.existsSync(passwordFile)) {
    print("Health check: arquivo de senha não encontrado.");
    quit(1);
  }

  // Lê a senha armazenada no Docker Secret
  const password = fs.readFileSync(passwordFile, "utf8").trim();

  if (!password) {
    print("Health check: arquivo de senha vazio.");
    quit(1);
  }

  // Seleciona o banco da aplicação
  const appDb = db.getSiblingDB("kubeshop");

  // Verifica a autenticação do usuário
  const authenticationResult = appDb.auth(username, password);

  // No mongosh, db.auth() retorna { ok: 1 } (o shell legado retornava 1).
  if (authenticationResult !== 1 && authenticationResult?.ok !== 1) {
    print("Health check: falha na autenticação.");
    quit(1);
  }

  // Verifica a disponibilidade do MongoDB
  const pingResult = appDb.runCommand({ ping: 1 });

  if (!pingResult || pingResult.ok !== 1) {
    print("Health check: falha no comando ping.");
    quit(1);
  }

  print("Health check: MongoDB disponível.");

  quit(0);

} catch (error) {
  // Não expõe credenciais nem detalhes internos
  print("Health check: erro durante a verificação.");
  quit(1);
}
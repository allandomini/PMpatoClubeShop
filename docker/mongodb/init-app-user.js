/**
 * KubeShop - Criação do usuário da aplicação no MongoDB
 *
 * Executado uma única vez pelo entrypoint oficial do MongoDB,
 * na primeira inicialização com o volume de dados vazio
 * (/docker-entrypoint-initdb.d).
 *
 * Cria um usuário com permissão apenas de leitura e escrita
 * no banco da aplicação. A API nunca usa o usuário root.
 *
 * Variáveis esperadas:
 * - MONGO_INITDB_DATABASE     Banco da aplicação (ex.: kubeshop)
 * - MONGO_APP_USERNAME        Usuário da aplicação
 * - MONGO_APP_PASSWORD_FILE   Arquivo com a senha (Docker Secret)
 *
 * A senha nunca é impressa.
 */
const fs = require("fs");

const database = process.env.MONGO_INITDB_DATABASE || "kubeshop";
const username = process.env.MONGO_APP_USERNAME;
const passwordFile = process.env.MONGO_APP_PASSWORD_FILE;

if (!username || !passwordFile) {
  throw new Error("MONGO_APP_USERNAME e MONGO_APP_PASSWORD_FILE são obrigatórios");
}

const password = fs.readFileSync(passwordFile, "utf8").replace(/\r?\n$/, "");

if (password.trim().length === 0) {
  throw new Error("O arquivo de senha da aplicação está vazio");
}

const target = db.getSiblingDB(database);

if (target.getUser(username)) {
  print(`Usuário da aplicação já existe em ${database}; nada a fazer.`);
} else {
  target.createUser({
    user: username,
    pwd: password,
    roles: [{ role: "readWrite", db: database }],
  });

  print(`Usuário da aplicação criado em ${database}.`);
}

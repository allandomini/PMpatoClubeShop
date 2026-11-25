const fs = require("fs");

// ==========================================================
// INICIALIZAÇÃO DO MONGODB - KUBESHOP
// ==========================================================

try {
  // 1. Recupera as configurações de autenticação
  const username = process.env.MONGO_APP_USERNAME;
  const passwordFile = process.env.MONGO_APP_PASSWORD_FILE;

  if (
    typeof username !== "string" ||
    username.trim().length === 0 ||
    !passwordFile
  ) {
    throw new Error("Configurações de autenticação ausentes.");
  }

  // 2. Verifica se o arquivo de senha está disponível
  if (!fs.existsSync(passwordFile)) {
    throw new Error("Arquivo de senha não encontrado.");
  }

  // 3. Lê a senha do Docker Secret
  const password = fs.readFileSync(passwordFile, "utf8").trim();

  if (!password) {
    throw new Error("Arquivo de senha vazio.");
  }

  // 4. Seleciona o banco de dados da aplicação
  const appDb = db.getSiblingDB("kubeshop");

  // 5. Define as permissões mínimas da aplicação
  const roles = [
    {
      role: "readWrite",
      db: "kubeshop"
    }
  ];

  // 6. Verifica se o usuário já existe
  const existingUser = appDb.getUser(username);

  if (existingUser) {
    // Atualiza a senha e as permissões se o usuário já existir
    appDb.updateUser(username, {
      pwd: password,
      roles: roles
    });

    print("Usuário da aplicação atualizado.");
  } else {
    // Cria o usuário da aplicação
    appDb.createUser({
      user: username,
      pwd: password,
      roles: roles
    });

    print("Usuário da aplicação criado.");
  }

  print("Inicialização do banco KubeShop concluída.");

} catch (error) {
  // Não registra senhas ou outros dados sensíveis
  print("Erro durante a inicialização do banco KubeShop.");
  quit(1);
}
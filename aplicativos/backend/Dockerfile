
# --------------------------------------------------
# ETAPA 1 - INSTALAÇÃO DAS DEPENDÊNCIAS
# --------------------------------------------------

FROM node:24.15.0-alpine3.23 AS dependencies

WORKDIR /app

# Copia os arquivos de dependências do backend.
COPY package.json package-lock.json ./

# Instala somente as dependências necessárias em produção.
RUN npm ci --omit=dev


# --------------------------------------------------
# ETAPA 2 - IMAGEM DE EXECUÇÃO
# --------------------------------------------------

FROM node:24.15.0-alpine3.23 AS runtime

# Configurações padrão do servidor.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

# Copia as dependências instaladas na etapa anterior.
COPY --from=dependencies --chown=node:node \
    /app/node_modules ./node_modules

# Copia os arquivos de configuração do backend.
COPY --chown=node:node package.json ./

# Copia o código-fonte da aplicação.
COPY --chown=node:node src ./src

# Executa a aplicação com usuário sem privilégios administrativos.
USER node

# Documenta a porta utilizada pela API.
EXPOSE 3000

# Verifica periodicamente a disponibilidade da aplicação
# e sua conexão com o MongoDB.
HEALTHCHECK --interval=30s \
    --timeout=5s \
    --start-period=60s \
    --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Inicia o servidor Node.js.
CMD ["node", "src/server.js"]
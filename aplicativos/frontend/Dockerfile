
# ==========================================================
# ESTÁGIO 1: BUILD - Compilação do frontend React
# ==========================================================
FROM node:24.15.0-alpine3.23 AS build

WORKDIR /app

# Copia os arquivos de dependências do frontend
COPY package.json package-lock.json ./

# Instala as dependências de forma reproduzível
RUN npm ci --ignore-scripts

# Copia o restante do código-fonte do frontend
COPY . .

# Compila a aplicação React
RUN npm run build


# ==========================================================
# ESTÁGIO 2: RUNTIME - Servidor Nginx
# ==========================================================
FROM nginx:1.28.0-alpine AS runtime

# Remove a configuração padrão do Nginx e instala
# a configuração específica do KubeShop
COPY nginx.conf /etc/nginx/nginx.conf

# Copia somente os arquivos compilados do React
COPY --from=build /app/dist /usr/share/nginx/html

# Executa o Nginx sem privilégios de root
USER 101:101

# Porta HTTP utilizada pelo Nginx
EXPOSE 8080

# Inicia o servidor Nginx em primeiro plano
ENTRYPOINT ["nginx", "-g", "daemon off;"]
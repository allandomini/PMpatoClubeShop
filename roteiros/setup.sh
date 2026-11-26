#!/usr/bin/env sh
# ==========================================================
# KubeShop - Preparação do ambiente local (Linux / macOS)
#
# Confere se o Node.js está instalado e chama roteiros/setup.mjs,
# que faz o restante (Docker, .env, subida e verificação).
#
# Uso:  sh roteiros/setup.sh [--no-start] [--timeout 300]
# ==========================================================
set -eu

cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "✖ Node.js não encontrado. Instale a versão 24.15 ou superior: https://nodejs.org" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "✖ Docker não encontrado. Instale: https://docs.docker.com/get-docker/" >&2
  exit 1
fi

exec node roteiros/setup.mjs "$@"

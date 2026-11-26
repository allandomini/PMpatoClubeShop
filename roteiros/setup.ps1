# ==========================================================
# KubeShop - Preparação do ambiente local (Windows / PowerShell)
#
# Confere se o Node.js e o Docker estão instalados e chama
# roteiros/setup.mjs, que faz o restante.
#
# Uso:  powershell -ExecutionPolicy Bypass -File roteiros\setup.ps1 [--no-start]
# ==========================================================
$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js não encontrado. Instale a versão 24.15 ou superior: https://nodejs.org"
    exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker não encontrado. Instale o Docker Desktop: https://docs.docker.com/desktop/"
    exit 1
}

node roteiros/setup.mjs @args
exit $LASTEXITCODE

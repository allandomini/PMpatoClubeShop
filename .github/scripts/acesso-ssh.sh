#!/usr/bin/env bash
# ==========================================================
# KubeShop - Acesso SSH temporário do runner do GitHub Actions
#
# O SSH da VM da aplicação só aceita os IPs de admin_cidrs. Como o
# IP do runner muda a cada execução, este script:
#
#   abrir   adiciona no NSG da app uma regra SSH só para o IP do runner
#   fechar  remove TODAS as regras temporárias do pipeline
#           (rodar sempre ao final do job, mesmo com falha)
#
# As regras são criadas pelo Azure CLI, fora do Terraform, com nome
# "gha-temp-<id da execução>" e prioridade 300 (a faixa 300 a 399 é
# reservada a elas). O Terraform gerencia as próprias regras em recursos
# separados e não remove essas.
#
# Uso: acesso-ssh.sh abrir|fechar   (requer terraform init e az login)
# ==========================================================
set -euo pipefail

prefix="gha-temp-"

if ! rg_name="$(terraform -chdir=terraform output -raw resource_group_name 2>/dev/null)" || [[ -z "${rg_name}" ]] \
  || ! nsg_name="$(terraform -chdir=terraform output -raw app_nsg_name 2>/dev/null)" || [[ -z "${nsg_name}" ]]; then
  if [[ "${1:-}" == "fechar" ]]; then
    # Após "desativar" o NSG não existe mais: nada a fechar.
    echo "NSG da aplicação não encontrado no estado; nada a fechar."
    exit 0
  fi
  echo "NSG da aplicação não encontrado. O ambiente foi provisionado?" >&2
  exit 1
fi

fechar() {
  local names name count=0
  names="$(az network nsg rule list --resource-group "${rg_name}" --nsg-name "${nsg_name}" \
    --query "[?starts_with(name, '${prefix}')].name" --output tsv 2>/dev/null || true)"

  while IFS= read -r name; do
    [[ -n "${name}" ]] || continue
    az network nsg rule delete --resource-group "${rg_name}" --nsg-name "${nsg_name}" --name "${name}" --output none
    count=$((count + 1))
  done <<< "${names}"

  echo "Regras temporárias de SSH removidas: ${count}."
}

case "${1:-}" in
  abrir)
    ip="$(curl -fsS --retry 3 https://api.ipify.org)"
    [[ "${ip}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "IP do runner inválido: ${ip}" >&2; exit 1; }

    # Remove restos de execuções interrompidas antes de criar a nova regra.
    fechar >/dev/null

    az network nsg rule create \
      --resource-group "${rg_name}" --nsg-name "${nsg_name}" \
      --name "${prefix}${GITHUB_RUN_ID:-local}" \
      --priority 300 --direction Inbound --access Allow --protocol Tcp \
      --source-address-prefixes "${ip}/32" --source-port-ranges '*' \
      --destination-address-prefixes '*' --destination-port-ranges 22 \
      --description "GitHub Actions, execução ${GITHUB_RUN_ID:-local}" \
      --output none
    echo "SSH liberado temporariamente para o IP do runner (${ip}/32)."

    # Aguarda a regra valer e o SSH responder.
    host="$(terraform -chdir=terraform output -raw app_public_ip)"
    for _ in $(seq 1 30); do
      if timeout 5 bash -c "</dev/tcp/${host}/22" 2>/dev/null; then
        echo "SSH da VM da aplicação respondendo."
        exit 0
      fi
      sleep 5
    done
    echo "O SSH não respondeu a tempo." >&2
    exit 1
    ;;

  fechar)
    fechar
    ;;

  *)
    echo "uso: $0 abrir|fechar" >&2
    exit 2
    ;;
esac

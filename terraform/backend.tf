# ==========================================================
# KubeShop - Armazenamento do estado do Terraform
#
# O estado fica em um contêiner do Azure Blob Storage. Assim ele não
# depende do computador de quem executou e pode ser usado pelos
# pipelines.
#
# O contêiner do estado é criado UMA vez, à mão, antes do primeiro
# "terraform init" (ele não pode ser gerenciado pelo próprio estado):
#
#   az group create -n kubeshop-tfstate-rg -l brazilsouth
#   az storage account create -g kubeshop-tfstate-rg -n <CONTA_UNICA> \
#     --sku Standard_LRS --min-tls-version TLS1_2 --allow-blob-public-access false
#   az storage account blob-service-properties update -g kubeshop-tfstate-rg \
#     --account-name <CONTA_UNICA> --enable-versioning true \
#     --enable-delete-retention true --delete-retention-days 30
#   az storage container create --account-name <CONTA_UNICA> -n tfstate --auth-mode login
#
# Proteção e recuperação:
# - Conta privada (sem acesso público), com versionamento e com
#   recuperação de exclusão (soft delete) de 30 dias: uma versão
#   anterior do estado pode ser restaurada pelo portal ou com
#   "az storage blob download --version-id".
# - Acesso por Microsoft Entra ID (use_azuread_auth): quem opera precisa
#   do papel "Storage Blob Data Contributor" na conta. Sem chaves de
#   conta espalhadas.
# - Trava de concorrência nativa: o Azure Blob usa lease no arquivo de
#   estado, então duas execuções simultâneas não corrompem o estado.
#
# Os valores específicos da conta ficam em terraform/backend.hcl
# (ignorado pelo Git):
#
#   resource_group_name  = "kubeshop-tfstate-rg"
#   storage_account_name = "<CONTA_UNICA>"
#   container_name       = "tfstate"
#
#   terraform init -backend-config=backend.hcl
#
# Para testar sem nuvem: terraform init -backend=false
# ==========================================================

terraform {
  backend "azurerm" {
    key              = "kubeshop.tfstate"
    use_azuread_auth = true
  }
}

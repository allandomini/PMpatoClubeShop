# ==========================================================
# KubeShop - Provedor Microsoft Azure (azurerm)
#
# Autenticação, em ordem de preferência:
#
# 1. Local: "az login" (e "az account set --subscription <ID>").
# 2. Pipelines: service principal informado por variáveis de ambiente
#    (ARM_CLIENT_ID, ARM_CLIENT_SECRET, ARM_TENANT_ID,
#    ARM_SUBSCRIPTION_ID), vindas dos segredos do pipeline.
#    Nada fica no repositório.
# ==========================================================

terraform {
  required_version = ">= 1.12.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.0"
    }
  }
}

provider "azurerm" {
  subscription_id = var.subscription_id

  features {
    storage {
      # A conta de backups tem firewall: sem isto o provedor tentaria ler
      # propriedades do plano de dados a partir do IP de quem executa o
      # Terraform, que não está na lista de IPs permitidos.
      data_plane_available = false
    }

    resource_group {
      # Impede apagar o grupo de recursos se algo (como o disco de dados)
      # tiver sido criado ou mantido dentro dele fora do Terraform.
      prevent_deletion_if_contains_resources = true
    }
  }
}

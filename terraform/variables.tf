# ==========================================================
# KubeShop - Variáveis do Terraform
#
# Valores da conta ficam em terraform.tfvars (ignorado pelo Git);
# veja terraform.tfvars.example. Nenhuma chave ou senha entra aqui:
# as credenciais do Azure vêm do "az login" ou de ARM_*.
# ==========================================================

# ----------------------------------------------------------
# Conta e localização
# ----------------------------------------------------------

variable "subscription_id" {
  description = "ID da assinatura (subscription) do Azure."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$", var.subscription_id))
    error_message = "Informe o ID da assinatura no formato GUID (az account show --query id -o tsv)."
  }
}

variable "location" {
  description = "Região do Azure. brazilsouth (São Paulo) reduz a latência para o público brasileiro; eastus2 tem VMs cerca de 38% mais baratas."
  type        = string
  default     = "brazilsouth"
}

# ----------------------------------------------------------
# Acesso administrativo
# ----------------------------------------------------------

variable "ssh_public_key" {
  description = "Chave SSH pública (conteúdo) autorizada no usuário 'ubuntu' das VMs. Aceita RSA (2048+) e ed25519."
  type        = string
}

variable "admin_cidrs" {
  description = "Redes autorizadas a acessar o SSH da VM da aplicação (ex.: [\"203.0.113.10/32\"]). Nunca 0.0.0.0/0."
  type        = list(string)

  validation {
    condition     = length(var.admin_cidrs) > 0 && !contains(var.admin_cidrs, "0.0.0.0/0") && !contains(var.admin_cidrs, "*")
    error_message = "Informe ao menos um CIDR administrativo e não use 0.0.0.0/0 nem *."
  }

  validation {
    condition     = alltrue([for cidr in var.admin_cidrs : can(cidrhost(cidr, 0))])
    error_message = "Cada item de admin_cidrs deve ser um CIDR válido, como 203.0.113.10/32."
  }
}

# ----------------------------------------------------------
# Rede
# ----------------------------------------------------------

variable "vnet_cidr" {
  description = "Faixa de endereços da rede virtual (VNet)."
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidr" {
  description = "Sub-rede da VM da aplicação (recebe o IP público)."
  type        = string
  default     = "10.20.1.0/24"
}

variable "private_subnet_cidr" {
  description = "Sub-rede privada da VM do MongoDB (sem IP público)."
  type        = string
  default     = "10.20.2.0/24"
}

variable "domain_name_label" {
  description = "Prefixo DNS gratuito do IP público (<label>.<região>.cloudapp.azure.com). Precisa ser único na região; vazio = só o IP."
  type        = string
  default     = null
}

# ----------------------------------------------------------
# Máquinas virtuais
# ----------------------------------------------------------

variable "app_vm_size" {
  description = "Tamanho da VM da aplicação. Standard_B2s: 2 vCPU e 4 GB, folga para construir as imagens na própria VM. Standard_B1ms (2 GB) funciona se as imagens vierem de um registro."
  type        = string
  default     = "Standard_B2s"
}

variable "db_vm_size" {
  description = "Tamanho da VM do MongoDB. Standard_B2s: 2 vCPU e 4 GB (o MongoDB usa cerca de metade da RAM para cache)."
  type        = string
  default     = "Standard_B2s"
}

variable "admin_username" {
  description = "Usuário administrador das VMs (acesso só por chave SSH, com sudo sem senha)."
  type        = string
  default     = "ubuntu"
}

variable "os_disk_gb" {
  description = "Tamanho do disco de sistema de cada VM (a imagem do Ubuntu tem 30 GB)."
  type        = number
  default     = 30

  validation {
    condition     = var.os_disk_gb >= 30
    error_message = "O disco de sistema precisa ter pelo menos 30 GB."
  }
}

# ----------------------------------------------------------
# Dados e backups
# ----------------------------------------------------------

variable "mongo_data_disk_gb" {
  description = "Tamanho do disco gerenciado dedicado aos dados do MongoDB (Standard SSD)."
  type        = number
  default     = 64

  validation {
    condition     = var.mongo_data_disk_gb >= 4
    error_message = "O disco de dados precisa ter pelo menos 4 GB."
  }
}

variable "backup_storage_account" {
  description = "Nome da conta de armazenamento dos dumps do MongoDB: 3 a 24 letras minúsculas e números, único em todo o Azure."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{3,24}$", var.backup_storage_account))
    error_message = "Use de 3 a 24 caracteres, só letras minúsculas e números."
  }
}

variable "backup_container_name" {
  description = "Nome do contêiner que recebe os dumps."
  type        = string
  default     = "backups"
}

variable "backup_allowed_ips" {
  description = "IPs públicos extras (além da sub-rede do banco) autorizados a acessar a conta de backups, ex.: o IP de quem baixa dumps à mão. Só IPs, não CIDRs /31 ou menores."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for ip in var.backup_allowed_ips : can(regex("^[0-9]{1,3}(\\.[0-9]{1,3}){3}$", ip))])
    error_message = "Informe endereços IPv4 simples, como 203.0.113.10."
  }
}

variable "backup_retention_days" {
  description = "Dias de recuperação (soft delete) dos dumps apagados ou sobrescritos no contêiner."
  type        = number
  default     = 7
}

variable "backup_sas_start" {
  description = "Início de validade (RFC 3339) do link SAS usado pela VM do banco para enviar e baixar backups."
  type        = string
  default     = "2026-11-01T00:00:00Z"
}

variable "backup_sas_expiry" {
  description = "Fim de validade (RFC 3339) do link SAS. Antes de vencer, altere este valor e rode o pipeline para renovar."
  type        = string
  default     = "2027-11-01T00:00:00Z"
}

# ----------------------------------------------------------
# Identificação
# ----------------------------------------------------------

variable "project_name" {
  description = "Prefixo dos nomes dos recursos."
  type        = string
  default     = "kubeshop"
}

variable "environment" {
  description = "Nome do ambiente (vai nas tags)."
  type        = string
  default     = "producao"
}

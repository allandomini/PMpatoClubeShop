# ==========================================================
# KubeShop - Variáveis do Terraform
#
# Valores da conta ficam em terraform.tfvars (ignorado pelo Git);
# veja terraform.tfvars.example. Segredos vêm de TF_VAR_*.
# ==========================================================

# ----------------------------------------------------------
# Conta e autenticação
# ----------------------------------------------------------

variable "tenancy_ocid" {
  description = "OCID da tenancy (conta) OCI."
  type        = string
}

variable "compartment_ocid" {
  description = "OCID do compartimento onde os recursos serão criados."
  type        = string
}

variable "region" {
  description = "Região OCI. sa-saopaulo-1 reduz a latência para usuários no Brasil."
  type        = string
  default     = "sa-saopaulo-1"
}

variable "user_ocid" {
  description = "OCID do usuário da chave de API (vazio = usa ~/.oci/config)."
  type        = string
  default     = null
}

variable "fingerprint" {
  description = "Fingerprint da chave de API (vazio = usa ~/.oci/config)."
  type        = string
  default     = null
}

variable "private_key" {
  description = "Conteúdo da chave privada da API (para pipelines, via TF_VAR_private_key)."
  type        = string
  default     = null
  sensitive   = true
}

variable "private_key_path" {
  description = "Caminho da chave privada da API (uso local)."
  type        = string
  default     = null
}

variable "oci_config_profile" {
  description = "Perfil do ~/.oci/config a usar quando as credenciais não forem passadas por variável."
  type        = string
  default     = null
}

# ----------------------------------------------------------
# Acesso administrativo
# ----------------------------------------------------------

variable "ssh_public_key" {
  description = "Chave SSH pública (conteúdo) autorizada no usuário 'ubuntu' das VMs."
  type        = string
}

variable "admin_cidrs" {
  description = "Redes autorizadas a acessar o SSH da VM da aplicação (ex.: [\"203.0.113.10/32\"]). Nunca 0.0.0.0/0."
  type        = list(string)

  validation {
    condition     = length(var.admin_cidrs) > 0 && !contains(var.admin_cidrs, "0.0.0.0/0")
    error_message = "Informe ao menos um CIDR administrativo e não use 0.0.0.0/0."
  }

  validation {
    condition     = alltrue([for cidr in var.admin_cidrs : can(cidrhost(cidr, 0))])
    error_message = "Cada item de admin_cidrs deve ser um CIDR válido, como 203.0.113.10/32."
  }
}

# ----------------------------------------------------------
# Rede
# ----------------------------------------------------------

variable "vcn_cidr" {
  description = "Faixa de endereços da rede virtual (VCN)."
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidr" {
  description = "Sub-rede pública da VM da aplicação."
  type        = string
  default     = "10.20.1.0/24"
}

variable "private_subnet_cidr" {
  description = "Sub-rede privada da VM do MongoDB (sem IP público)."
  type        = string
  default     = "10.20.2.0/24"
}

# ----------------------------------------------------------
# Máquinas virtuais
# ----------------------------------------------------------

variable "availability_domain_index" {
  description = "Índice do domínio de disponibilidade (0, 1 ou 2). São Paulo possui apenas o 0."
  type        = number
  default     = 0
}

variable "instance_shape" {
  description = "Shape das VMs. VM.Standard.A1.Flex (ARM Ampere) entra no Always Free até 4 OCPU / 24 GB no total."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "app_ocpus" {
  description = "OCPUs da VM da aplicação (shapes Flex)."
  type        = number
  default     = 1
}

variable "app_memory_gb" {
  description = "Memória (GB) da VM da aplicação (shapes Flex)."
  type        = number
  default     = 6
}

variable "db_ocpus" {
  description = "OCPUs da VM do MongoDB (shapes Flex)."
  type        = number
  default     = 1
}

variable "db_memory_gb" {
  description = "Memória (GB) da VM do MongoDB (shapes Flex)."
  type        = number
  default     = 6
}

variable "boot_volume_gb" {
  description = "Tamanho do disco de sistema de cada VM (mínimo 50 GB no OCI)."
  type        = number
  default     = 50

  validation {
    condition     = var.boot_volume_gb >= 50
    error_message = "O OCI exige boot volume de pelo menos 50 GB."
  }
}

variable "image_ocid" {
  description = "OCID de imagem específica. Vazio = Ubuntu 24.04 mais recente compatível com o shape."
  type        = string
  default     = null
}

# ----------------------------------------------------------
# Dados e backups
# ----------------------------------------------------------

variable "mongo_data_volume_gb" {
  description = "Tamanho do volume em bloco dedicado aos dados do MongoDB."
  type        = number
  default     = 50

  validation {
    condition     = var.mongo_data_volume_gb >= 50
    error_message = "O OCI exige block volume de pelo menos 50 GB."
  }
}

variable "enable_volume_backup_policy" {
  description = "Aplica a política Oracle 'bronze' de backup do volume de dados (cópia mensal do disco)."
  type        = bool
  default     = true
}

variable "backup_bucket_name" {
  description = "Nome do bucket que recebe os dumps diários do MongoDB."
  type        = string
  default     = "kubeshop-backups"
}

variable "backup_par_expires" {
  description = "Validade (RFC 3339) do link pré-autenticado usado pela VM do banco para enviar backups."
  type        = string
  default     = "2027-12-31T23:59:59Z"
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

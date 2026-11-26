# ==========================================================
# KubeShop - Provedor Oracle Cloud Infrastructure (OCI)
#
# Autenticação por chave de API. Duas formas suportadas:
#
# 1. Arquivo ~/.oci/config (uso local): deixe user_ocid,
#    fingerprint e private_key* vazios e, se quiser, informe
#    oci_config_profile.
#
# 2. Variáveis de ambiente (pipelines): defina
#    TF_VAR_user_ocid, TF_VAR_fingerprint e TF_VAR_private_key
#    a partir dos segredos do pipeline. Nada fica no repositório.
# ==========================================================

terraform {
  required_version = ">= 1.12.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 9.0"
    }
  }
}

provider "oci" {
  region              = var.region
  tenancy_ocid        = var.tenancy_ocid
  user_ocid           = var.user_ocid
  fingerprint         = var.fingerprint
  private_key         = var.private_key
  private_key_path    = var.private_key_path
  config_file_profile = var.oci_config_profile
}

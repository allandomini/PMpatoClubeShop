# ==========================================================
# KubeShop - Armazenamento do estado do Terraform
#
# O estado fica em um bucket do OCI Object Storage, acessado pela
# API compatível com S3. Assim ele não depende do computador de
# quem executou e pode ser usado pelos pipelines.
#
# O bucket do estado é criado UMA vez, à mão, antes do primeiro
# "terraform init" (ele não pode ser gerenciado pelo próprio estado):
#
#   oci os bucket create --name kubeshop-tfstate \
#     --compartment-id <COMPARTMENT_OCID> --versioning Enabled
#
# Proteção e recuperação:
# - Bucket privado (sem acesso público) e com versionamento: uma
#   versão anterior do estado pode ser restaurada pelo console ou
#   com "oci os object restore"/"oci os object get --version-id".
# - Acesso por "Customer Secret Key" do usuário OCI, informada como
#   AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY (segredos do pipeline).
# - Sem trava de concorrência: o pipeline serializa as execuções
#   (concurrency group); não rode apply local em paralelo.
#
# Os valores específicos da conta ficam em terraform/backend.hcl
# (ignorado pelo Git):
#
#   bucket    = "kubeshop-tfstate"
#   region    = "sa-saopaulo-1"
#   endpoints = { s3 = "https://<NAMESPACE>.compat.objectstorage.sa-saopaulo-1.oraclecloud.com" }
#
#   terraform init -backend-config=backend.hcl
#
# Para testar sem nuvem: terraform init -backend=false
# ==========================================================

terraform {
  backend "s3" {
    key = "kubeshop/terraform.tfstate"

    # O OCI não é AWS: desativa as verificações específicas da AWS.
    use_path_style              = true
    skip_region_validation      = true
    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

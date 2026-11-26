# ==========================================================
# KubeShop - Infraestrutura na Oracle Cloud
#
#   Internet
#      │  80/443 (todos)   22 (somente admin_cidrs)
#      ▼
#   ┌──────────── VCN 10.20.0.0/16 ─────────────────────────┐
#   │  Sub-rede pública 10.20.1.0/24                         │
#   │   VM app (Nginx + React + API)  IP privado .10         │
#   │      │ 27017 e 22 (somente a partir da NSG app)        │
#   │      ▼                                                 │
#   │  Sub-rede privada 10.20.2.0/24 (sem IP público)        │
#   │   VM db (MongoDB) IP privado .10 + volume de dados     │
#   │      │ saída por NAT (atualizações) e Service Gateway  │
#   │      ▼ (backups no Object Storage)                     │
#   └────────────────────────────────────────────────────────┘
#
# Atende: REQ-01 (2 VMs), REQ-02/03 (banco isolado na rede privada),
# REQ-04 (SSH restrito), REQ-05 (volume de dados separado da VM).
# ==========================================================

locals {
  name = var.project_name

  tags = {
    projeto        = var.project_name
    ambiente       = var.environment
    gerenciado_por = "terraform"
  }

  is_flex = endswith(var.instance_shape, ".Flex")

  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_index].name

  image_id = coalesce(var.image_ocid, try(data.oci_core_images.ubuntu.images[0].id, null))

  app_private_ip = cidrhost(var.public_subnet_cidr, 10)
  db_private_ip  = cidrhost(var.private_subnet_cidr, 10)

  # Caminho fixo do volume dentro da VM (anexo paravirtualizado).
  mongo_device_path = "/dev/oracleoci/oraclevdb"
}

# ----------------------------------------------------------
# Consultas
# ----------------------------------------------------------

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = var.instance_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"

  # Exclui as variantes "Minimal".
  filter {
    name   = "display_name"
    values = ["^Canonical-Ubuntu-24\\.04-(aarch64-)?\\d{4}\\..*$"]
    regex  = true
  }
}

data "oci_core_services" "all" {
  filter {
    name   = "name"
    values = ["All .* Services In Oracle Services Network"]
    regex  = true
  }
}

data "oci_objectstorage_namespace" "this" {
  compartment_id = var.tenancy_ocid
}

# ----------------------------------------------------------
# Rede
# ----------------------------------------------------------

resource "oci_core_vcn" "main" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name}-vcn"
  cidr_blocks    = [var.vcn_cidr]
  dns_label      = "kubeshop"
  freeform_tags  = local.tags
}

resource "oci_core_internet_gateway" "main" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-igw"
  enabled        = true
  freeform_tags  = local.tags
}

# Saída para a internet da sub-rede privada (pacotes e imagens),
# sem permitir conexões de entrada. Sem custo no OCI.
resource "oci_core_nat_gateway" "main" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-nat"
  freeform_tags  = local.tags
}

# Acesso privado ao Object Storage (backups) sem passar pela internet.
resource "oci_core_service_gateway" "main" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-sgw"
  freeform_tags  = local.tags

  services {
    service_id = data.oci_core_services.all.services[0].id
  }
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-rt-publica"
  freeform_tags  = local.tags

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.main.id
  }
}

resource "oci_core_route_table" "private" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-rt-privada"
  freeform_tags  = local.tags

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_nat_gateway.main.id
  }

  route_rules {
    destination       = data.oci_core_services.all.services[0].cidr_block
    destination_type  = "SERVICE_CIDR_BLOCK"
    network_entity_id = oci_core_service_gateway.main.id
  }
}

# Substitui a security list padrão da VCN (que libera SSH para
# 0.0.0.0/0). As regras de entrada ficam nas NSGs abaixo.
resource "oci_core_security_list" "baseline" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-sl-base"
  freeform_tags  = local.tags

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
    stateless   = false
  }

  # Path MTU discovery.
  ingress_security_rules {
    source   = "0.0.0.0/0"
    protocol = "1" # ICMP
    icmp_options {
      type = 3
      code = 4
    }
  }

  # Mensagens ICMP internas (diagnóstico com ping dentro da VCN).
  ingress_security_rules {
    source   = var.vcn_cidr
    protocol = "1"
    icmp_options {
      type = 3
    }
  }
}

resource "oci_core_subnet" "public" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.main.id
  display_name      = "${local.name}-subnet-app"
  cidr_block        = var.public_subnet_cidr
  dns_label         = "app"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.baseline.id]
  freeform_tags     = local.tags
}

resource "oci_core_subnet" "private" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.main.id
  display_name               = "${local.name}-subnet-db"
  cidr_block                 = var.private_subnet_cidr
  dns_label                  = "db"
  route_table_id             = oci_core_route_table.private.id
  security_list_ids          = [oci_core_security_list.baseline.id]
  prohibit_public_ip_on_vnic = true
  freeform_tags              = local.tags
}

# ----------------------------------------------------------
# Regras de acesso (Network Security Groups)
# ----------------------------------------------------------

resource "oci_core_network_security_group" "app" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-nsg-app"
  freeform_tags  = local.tags
}

resource "oci_core_network_security_group" "db" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-nsg-db"
  freeform_tags  = local.tags
}

# Loja: HTTP e HTTPS abertos ao público.
resource "oci_core_network_security_group_security_rule" "app_web" {
  for_each = toset(["80", "443"])

  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "Loja KubeShop (porta ${each.key})"

  tcp_options {
    destination_port_range {
      min = tonumber(each.key)
      max = tonumber(each.key)
    }
  }
}

# SSH administrativo somente a partir das redes autorizadas.
resource "oci_core_network_security_group_security_rule" "app_ssh" {
  for_each = toset(var.admin_cidrs)

  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = each.key
  source_type               = "CIDR_BLOCK"
  description               = "SSH administrativo"

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

resource "oci_core_network_security_group_security_rule" "app_egress" {
  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
}

# MongoDB: aceita conexões SOMENTE da NSG da aplicação (REQ-03).
resource "oci_core_network_security_group_security_rule" "db_mongo" {
  network_security_group_id = oci_core_network_security_group.db.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = oci_core_network_security_group.app.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "MongoDB a partir da VM da aplicação"

  tcp_options {
    destination_port_range {
      min = 27017
      max = 27017
    }
  }
}

# SSH do banco somente passando pela VM da aplicação (ProxyJump).
resource "oci_core_network_security_group_security_rule" "db_ssh" {
  network_security_group_id = oci_core_network_security_group.db.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = oci_core_network_security_group.app.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "SSH administrativo via VM da aplicação"

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

resource "oci_core_network_security_group_security_rule" "db_egress" {
  network_security_group_id = oci_core_network_security_group.db.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
}

# ----------------------------------------------------------
# Máquinas virtuais
# ----------------------------------------------------------

resource "oci_core_instance" "app" {
  compartment_id      = var.compartment_ocid
  availability_domain = local.availability_domain
  display_name        = "${local.name}-app"
  shape               = var.instance_shape
  freeform_tags       = merge(local.tags, { funcao = "aplicacao" })

  dynamic "shape_config" {
    for_each = local.is_flex ? [1] : []
    content {
      ocpus         = var.app_ocpus
      memory_in_gbs = var.app_memory_gb
    }
  }

  source_details {
    source_type             = "image"
    source_id               = local.image_id
    boot_volume_size_in_gbs = var.boot_volume_gb
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    private_ip       = local.app_private_ip
    assign_public_ip = true
    hostname_label   = "app"
    nsg_ids          = [oci_core_network_security_group.app.id]
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
  }

  lifecycle {
    # Novas imagens do Ubuntu não devem recriar a VM sozinhas.
    ignore_changes = [source_details[0].source_id]
  }
}

resource "oci_core_instance" "db" {
  compartment_id      = var.compartment_ocid
  availability_domain = local.availability_domain
  display_name        = "${local.name}-db"
  shape               = var.instance_shape
  freeform_tags       = merge(local.tags, { funcao = "banco" })

  dynamic "shape_config" {
    for_each = local.is_flex ? [1] : []
    content {
      ocpus         = var.db_ocpus
      memory_in_gbs = var.db_memory_gb
    }
  }

  source_details {
    source_type             = "image"
    source_id               = local.image_id
    boot_volume_size_in_gbs = var.boot_volume_gb
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.private.id
    private_ip       = local.db_private_ip
    assign_public_ip = false
    hostname_label   = "db"
    nsg_ids          = [oci_core_network_security_group.db.id]
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
  }

  lifecycle {
    ignore_changes = [source_details[0].source_id]
  }
}

# ----------------------------------------------------------
# Armazenamento persistente do MongoDB
# ----------------------------------------------------------

# Volume separado da VM: os dados sobrevivem à troca ou recriação
# da VM do banco (alteração de infraestrutura que preserva dados).
resource "oci_core_volume" "mongo_data" {
  compartment_id      = var.compartment_ocid
  availability_domain = local.availability_domain
  display_name        = "${local.name}-mongo-data"
  size_in_gbs         = var.mongo_data_volume_gb
  vpus_per_gb         = 10 # desempenho "Balanced"
  freeform_tags       = merge(local.tags, { funcao = "dados-mongodb" })

  lifecycle {
    # Impede a remoção acidental dos dados. A desativação completa
    # exige remover esta linha conscientemente (veja o README).
    prevent_destroy = true
  }
}

resource "oci_core_volume_attachment" "mongo_data" {
  attachment_type = "paravirtualized"
  instance_id     = oci_core_instance.db.id
  volume_id       = oci_core_volume.mongo_data.id
  device          = local.mongo_device_path
  display_name    = "${local.name}-mongo-data-attachment"
}

data "oci_core_volume_backup_policies" "oracle" {
  filter {
    name   = "display_name"
    values = ["bronze"]
  }
}

resource "oci_core_volume_backup_policy_assignment" "mongo_data" {
  count = var.enable_volume_backup_policy ? 1 : 0

  asset_id  = oci_core_volume.mongo_data.id
  policy_id = data.oci_core_volume_backup_policies.oracle.volume_backup_policies[0].id
}

# ----------------------------------------------------------
# Backups lógicos (mongodump) no Object Storage
# ----------------------------------------------------------

resource "oci_objectstorage_bucket" "backups" {
  compartment_id = var.compartment_ocid
  namespace      = data.oci_objectstorage_namespace.this.namespace
  name           = var.backup_bucket_name
  access_type    = "NoPublicAccess"
  versioning     = "Disabled"
  freeform_tags  = local.tags
}

# Link pré-autenticado usado pela VM do banco para enviar e baixar
# dumps. Evita configurar usuários/políticas IAM dentro da VM.
# É um segredo: sai apenas como output "sensitive".
resource "oci_objectstorage_preauthrequest" "backups" {
  namespace             = data.oci_objectstorage_namespace.this.namespace
  bucket                = oci_objectstorage_bucket.backups.name
  name                  = "${local.name}-backup-writer"
  access_type           = "AnyObjectReadWrite"
  bucket_listing_action = "ListObjects"
  time_expires          = var.backup_par_expires
}

# ==========================================================
# KubeShop - Infraestrutura no Microsoft Azure
#
#   Internet
#      │  80/443 (todos)   22 (somente admin_cidrs)
#      ▼
#   ┌──────────── VNet 10.20.0.0/16 ────────────────────────┐
#   │  Sub-rede da app 10.20.1.0/24                          │
#   │   VM app (Nginx + React + API)  IP privado .10         │
#   │      │ 27017 e 22 (somente a partir do grupo "app")    │
#   │      ▼                                                 │
#   │  Sub-rede privada 10.20.2.0/24 (sem IP público)        │
#   │   VM db (MongoDB) IP privado .10 + disco de dados      │
#   │      │ saída pelo NAT Gateway (atualizações, imagens)  │
#   └──────┼─────────────────────────────────────────────────┘
#          ▼
#   Storage Account: contêiner "backups" (cópia externa dos dumps)
#
# Atende: REQ-01 (2 VMs), REQ-02/03 (banco isolado na rede privada),
# REQ-04 (SSH restrito), REQ-05 (disco de dados separado da VM).
#
# As regras de segurança são recursos separados (e não blocos dentro
# do NSG) para o Terraform não apagar as regras temporárias de SSH que
# o pipeline cria para o IP do runner.
# ==========================================================

locals {
  name = var.project_name

  tags = {
    projeto        = var.project_name
    ambiente       = var.environment
    gerenciado_por = "terraform"
  }

  app_private_ip = cidrhost(var.public_subnet_cidr, 10)
  db_private_ip  = cidrhost(var.private_subnet_cidr, 10)

  # Caminho fixo do disco de dados dentro da VM (LUN 0): o Azure cria
  # este link estável em /dev/disk/azure/scsi1.
  mongo_device_path = "/dev/disk/azure/scsi1/lun0"
}

resource "azurerm_resource_group" "main" {
  name     = "${local.name}-rg"
  location = var.location
  tags     = local.tags
}

# ----------------------------------------------------------
# Rede
# ----------------------------------------------------------

resource "azurerm_virtual_network" "main" {
  name                = "${local.name}-vnet"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = [var.vnet_cidr]
  tags                = local.tags
}

resource "azurerm_subnet" "public" {
  name                 = "app"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.public_subnet_cidr]
}

resource "azurerm_subnet" "private" {
  name                 = "db"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.private_subnet_cidr]

  # Sem saída implícita para a internet: a saída é só pelo NAT Gateway.
  default_outbound_access_enabled = false

  # Caminho direto e privado até o Blob Storage (backups). O firewall da
  # conta de backups só vale para esta sub-rede por este endpoint: regras
  # de IP não se aplicam a pedidos da mesma região do Azure.
  service_endpoint {
    service = "Microsoft.Storage"
  }
}

# Saída para a internet da sub-rede privada (pacotes e imagens), sem
# permitir conexões de entrada.
resource "azurerm_public_ip" "nat" {
  name                = "${local.name}-nat-ip"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.tags
}

resource "azurerm_nat_gateway" "main" {
  name                = "${local.name}-nat"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku_name            = "Standard"
  tags                = local.tags
}

resource "azurerm_nat_gateway_public_ip_association" "main" {
  nat_gateway_id       = azurerm_nat_gateway.main.id
  public_ip_address_id = azurerm_public_ip.nat.id
}

resource "azurerm_subnet_nat_gateway_association" "private" {
  subnet_id      = azurerm_subnet.private.id
  nat_gateway_id = azurerm_nat_gateway.main.id

  depends_on = [azurerm_nat_gateway_public_ip_association.main]
}

# ----------------------------------------------------------
# Regras de acesso (Network Security Groups)
# ----------------------------------------------------------

# Grupos de segurança de aplicação: permitem escrever as regras do banco
# como "somente a partir da VM da aplicação", sem depender de IPs.
resource "azurerm_application_security_group" "app" {
  name                = "${local.name}-asg-app"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_application_security_group" "db" {
  name                = "${local.name}-asg-db"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_network_security_group" "app" {
  name                = "${local.name}-nsg-app"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_network_security_group" "db" {
  name                = "${local.name}-nsg-db"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_subnet_network_security_group_association" "public" {
  subnet_id                 = azurerm_subnet.public.id
  network_security_group_id = azurerm_network_security_group.app.id
}

resource "azurerm_subnet_network_security_group_association" "private" {
  subnet_id                 = azurerm_subnet.private.id
  network_security_group_id = azurerm_network_security_group.db.id
}

# Loja: HTTP e HTTPS abertos ao público.
# Intencional: é a vitrine pública da loja. Nenhuma outra porta é aberta ao mundo.
#trivy:ignore:AVD-AZU-0047
resource "azurerm_network_security_rule" "app_web" {
  name                        = "permitir-http-https"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_ranges     = ["80", "443"]
  source_address_prefix       = "Internet"
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.app.name
  description                 = "Loja KubeShop"
}

# SSH administrativo somente a partir das redes autorizadas.
# Prioridades 300 a 399 ficam reservadas às regras temporárias do pipeline.
resource "azurerm_network_security_rule" "app_ssh" {
  name                        = "permitir-ssh-admin"
  priority                    = 200
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "22"
  source_address_prefixes     = var.admin_cidrs
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.app.name
  description                 = "SSH administrativo"
}

# Nega o restante do tráfego interno da VNet (a regra padrão do Azure
# liberaria qualquer VM da rede).
resource "azurerm_network_security_rule" "app_deny_vnet" {
  name                        = "negar-vnet"
  priority                    = 4000
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "*"
  source_port_range           = "*"
  destination_port_range      = "*"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.app.name
  description                 = "Nega o tráfego interno não previsto"
}

# MongoDB: aceita conexões SOMENTE do grupo da aplicação (REQ-03).
resource "azurerm_network_security_rule" "db_mongo" {
  name                                       = "permitir-mongodb-da-app"
  priority                                   = 100
  direction                                  = "Inbound"
  access                                     = "Allow"
  protocol                                   = "Tcp"
  source_port_range                          = "*"
  destination_port_range                     = "27017"
  source_application_security_group_ids      = [azurerm_application_security_group.app.id]
  destination_application_security_group_ids = [azurerm_application_security_group.db.id]
  resource_group_name                        = azurerm_resource_group.main.name
  network_security_group_name                = azurerm_network_security_group.db.name
  description                                = "MongoDB a partir da VM da aplicação"
}

# SSH do banco somente passando pela VM da aplicação (ProxyCommand).
resource "azurerm_network_security_rule" "db_ssh" {
  name                                       = "permitir-ssh-via-app"
  priority                                   = 110
  direction                                  = "Inbound"
  access                                     = "Allow"
  protocol                                   = "Tcp"
  source_port_range                          = "*"
  destination_port_range                     = "22"
  source_application_security_group_ids      = [azurerm_application_security_group.app.id]
  destination_application_security_group_ids = [azurerm_application_security_group.db.id]
  resource_group_name                        = azurerm_resource_group.main.name
  network_security_group_name                = azurerm_network_security_group.db.name
  description                                = "SSH administrativo via VM da aplicação"
}

resource "azurerm_network_security_rule" "db_deny_vnet" {
  name                        = "negar-vnet"
  priority                    = 4000
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "*"
  source_port_range           = "*"
  destination_port_range      = "*"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.db.name
  description                 = "Nega o tráfego interno não previsto"
}

# ----------------------------------------------------------
# Máquinas virtuais
# ----------------------------------------------------------

resource "azurerm_public_ip" "app" {
  name                = "${local.name}-app-ip"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
  domain_name_label   = var.domain_name_label
  tags                = local.tags
}

# O NSG está associado à sub-rede (e não à interface): a regra vale igual.
# O IP público da VM da aplicação é intencional: é a entrada da loja.
#trivy:ignore:AVD-AZU-0068
#trivy:ignore:AVD-AZU-0076
resource "azurerm_network_interface" "app" {
  name                = "${local.name}-app-nic"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags

  ip_configuration {
    name                          = "interna"
    subnet_id                     = azurerm_subnet.public.id
    private_ip_address_allocation = "Static"
    private_ip_address            = local.app_private_ip
    public_ip_address_id          = azurerm_public_ip.app.id
  }
}

# O NSG está associado à sub-rede (e não à interface): a regra vale igual.
#trivy:ignore:AVD-AZU-0068
resource "azurerm_network_interface" "db" {
  name                = "${local.name}-db-nic"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags

  ip_configuration {
    name                          = "interna"
    subnet_id                     = azurerm_subnet.private.id
    private_ip_address_allocation = "Static"
    private_ip_address            = local.db_private_ip
  }
}

resource "azurerm_network_interface_application_security_group_association" "app" {
  network_interface_id          = azurerm_network_interface.app.id
  application_security_group_id = azurerm_application_security_group.app.id
}

resource "azurerm_network_interface_application_security_group_association" "db" {
  network_interface_id          = azurerm_network_interface.db.id
  application_security_group_id = azurerm_application_security_group.db.id
}

resource "azurerm_linux_virtual_machine" "app" {
  name                = "${local.name}-app"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  size                = var.app_vm_size
  admin_username      = var.admin_username
  tags                = merge(local.tags, { funcao = "aplicacao" })

  network_interface_ids           = [azurerm_network_interface.app.id]
  disable_password_authentication = true

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = var.os_disk_gb
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  # Diagnóstico de inicialização (console serial) em armazenamento gerenciado.
  boot_diagnostics {}
}

resource "azurerm_linux_virtual_machine" "db" {
  name                = "${local.name}-db"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  size                = var.db_vm_size
  admin_username      = var.admin_username
  tags                = merge(local.tags, { funcao = "banco" })

  network_interface_ids           = [azurerm_network_interface.db.id]
  disable_password_authentication = true

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = var.os_disk_gb
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  boot_diagnostics {}

  # A saída para a internet (apt, imagens do Docker) depende do NAT.
  depends_on = [azurerm_subnet_nat_gateway_association.private]
}

# ----------------------------------------------------------
# Armazenamento persistente do MongoDB
# ----------------------------------------------------------

# Disco separado da VM: os dados sobrevivem à troca ou recriação da VM
# do banco (alteração de infraestrutura que preserva dados).
resource "azurerm_managed_disk" "mongo_data" {
  name                 = "${local.name}-mongo-data"
  location             = azurerm_resource_group.main.location
  resource_group_name  = azurerm_resource_group.main.name
  storage_account_type = "StandardSSD_LRS"
  create_option        = "Empty"
  disk_size_gb         = var.mongo_data_disk_gb
  tags                 = merge(local.tags, { funcao = "dados-mongodb" })

  lifecycle {
    # Impede a remoção acidental dos dados. A desativação completa
    # exige remover esta linha conscientemente (veja o README).
    prevent_destroy = true
  }
}

resource "azurerm_virtual_machine_data_disk_attachment" "mongo_data" {
  managed_disk_id    = azurerm_managed_disk.mongo_data.id
  virtual_machine_id = azurerm_linux_virtual_machine.db.id
  lun                = 0
  caching            = "ReadOnly"
}

# ----------------------------------------------------------
# Backups lógicos (mongodump) no Blob Storage
# ----------------------------------------------------------

# Achados aceitos de propósito, por custo e escopo: sem logs de acesso
# (0057), sem replicação geográfica (0058), sem chave própria (0060) e sem
# criptografia dupla (0061). Os dados já são criptografados pelo Azure e os
# dumps contêm só pedidos fictícios. Veja README → Limitações.
#trivy:ignore:AVD-AZU-0057
#trivy:ignore:AVD-AZU-0058
#trivy:ignore:AVD-AZU-0060
#trivy:ignore:AVD-AZU-0061
resource "azurerm_storage_account" "backups" {
  name                     = var.backup_storage_account
  location                 = azurerm_resource_group.main.location
  resource_group_name      = azurerm_resource_group.main.name
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"
  min_tls_version          = "TLS1_2"
  tags                     = local.tags

  allow_nested_items_to_be_public = false

  # Só a sub-rede do banco (pelo service endpoint Microsoft.Storage) e os
  # IPs listados em backup_allowed_ips acessam a conta. Um token SAS vazado
  # não serve a quem está fora dessa lista.
  network_rules {
    default_action             = "Deny"
    virtual_network_subnet_ids = [azurerm_subnet.private.id]
    ip_rules                   = var.backup_allowed_ips
    bypass                     = ["AzureServices"]
  }

  blob_properties {
    # Recupera dumps apagados ou sobrescritos por engano.
    delete_retention_policy {
      days = var.backup_retention_days
    }
  }

  lifecycle {
    # Os dumps são a cópia externa dos dados: não podem sumir por engano.
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "backups" {
  name                  = var.backup_container_name
  storage_account_id    = azurerm_storage_account.backups.id
  container_access_type = "private"
}

# Link SAS (assinatura de acesso compartilhado) usado pela VM do banco
# para enviar e baixar dumps. Evita configurar identidades dentro da VM.
# Dá acesso apenas a este contêiner, não permite apagar e vence na data
# de backup_sas_expiry. É um segredo: sai só como output "sensitive".
data "azurerm_storage_account_blob_container_sas" "backups" {
  connection_string = azurerm_storage_account.backups.primary_connection_string
  container_name    = azurerm_storage_container.backups.name
  https_only        = true

  start  = var.backup_sas_start
  expiry = var.backup_sas_expiry

  permissions {
    read   = true
    add    = true
    create = true
    write  = true
    delete = false
    list   = true
  }
}

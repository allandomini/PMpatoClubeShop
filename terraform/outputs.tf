# ==========================================================
# KubeShop - Saídas do Terraform
#
#   terraform output                     (resumo)
#   terraform output -raw ansible_inventory > ../ansible/inventory.local.ini
#   terraform output -raw backup_sas_url (segredo; não cole em logs)
# ==========================================================

output "store_url" {
  description = "Endereço público da loja."
  value       = "http://${azurerm_public_ip.app.ip_address}"
}

output "app_public_ip" {
  description = "IP público da VM da aplicação."
  value       = azurerm_public_ip.app.ip_address
}

output "app_fqdn" {
  description = "Nome DNS gratuito do IP público (vazio se domain_name_label não foi definido)."
  value       = azurerm_public_ip.app.fqdn
}

output "app_private_ip" {
  description = "IP privado da VM da aplicação."
  value       = azurerm_network_interface.app.private_ip_address
}

output "db_private_ip" {
  description = "IP privado da VM do MongoDB (sem IP público)."
  value       = azurerm_network_interface.db.private_ip_address
}

output "ssh_app" {
  description = "Comando SSH para a VM da aplicação."
  value       = "ssh ${var.admin_username}@${azurerm_public_ip.app.ip_address}"
}

output "ssh_db" {
  description = "Comando SSH para a VM do banco, passando pela VM da aplicação."
  value       = "ssh -J ${var.admin_username}@${azurerm_public_ip.app.ip_address} ${var.admin_username}@${azurerm_network_interface.db.private_ip_address}"
}

output "resource_group_name" {
  description = "Grupo de recursos do ambiente."
  value       = azurerm_resource_group.main.name
}

output "app_nsg_name" {
  description = "NSG da aplicação (o pipeline abre nele, temporariamente, o SSH para o IP do runner)."
  value       = azurerm_network_security_group.app.name
}

output "mongo_device_path" {
  description = "Caminho do disco de dados dentro da VM do banco."
  value       = local.mongo_device_path
}

output "backup_storage_account" {
  description = "Conta de armazenamento que recebe os dumps do MongoDB."
  value       = azurerm_storage_account.backups.name
}

output "backup_container" {
  description = "Contêiner que recebe os dumps do MongoDB."
  value       = azurerm_storage_container.backups.name
}

output "backup_sas_url" {
  description = "URL do contêiner de backups com o token SAS (SEGREDO)."
  value       = "${azurerm_storage_account.backups.primary_blob_endpoint}${azurerm_storage_container.backups.name}${data.azurerm_storage_account_blob_container_sas.backups.sas}"
  sensitive   = true
}

output "inventory" {
  description = "Inventário dos recursos criados (critério ACE-02)."
  value = {
    vms = {
      app = {
        nome       = azurerm_linux_virtual_machine.app.name
        tamanho    = azurerm_linux_virtual_machine.app.size
        ip_publico = azurerm_public_ip.app.ip_address
        ip_privado = azurerm_network_interface.app.private_ip_address
      }
      db = {
        nome       = azurerm_linux_virtual_machine.db.name
        tamanho    = azurerm_linux_virtual_machine.db.size
        ip_publico = "nenhum"
        ip_privado = azurerm_network_interface.db.private_ip_address
      }
    }
    regiao            = azurerm_resource_group.main.location
    disco_dados_gb    = azurerm_managed_disk.mongo_data.disk_size_gb
    vnet              = var.vnet_cidr
    conta_backups     = azurerm_storage_account.backups.name
    conteiner_backups = azurerm_storage_container.backups.name
  }
}

output "ansible_inventory" {
  description = "Inventário pronto para o Ansible."
  value       = <<-EOT
    # Gerado por: terraform output -raw ansible_inventory
    [app]
    kubeshop-app ansible_host=${azurerm_public_ip.app.ip_address} private_ip=${azurerm_network_interface.app.private_ip_address}

    [db]
    kubeshop-db ansible_host=${azurerm_network_interface.db.private_ip_address} private_ip=${azurerm_network_interface.db.private_ip_address}

    [db:vars]
    ansible_ssh_common_args='-o ProxyCommand="ssh -o StrictHostKeyChecking=accept-new -W %h:%p -q ${var.admin_username}@${azurerm_public_ip.app.ip_address}"'

    [all:vars]
    ansible_user=${var.admin_username}
  EOT
}

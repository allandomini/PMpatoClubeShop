# ==========================================================
# KubeShop - Saídas do Terraform
#
#   terraform output                     (resumo)
#   terraform output -raw ansible_inventory > ../ansible/inventory.local.ini
#   terraform output -raw backup_par_url (segredo; não cole em logs)
# ==========================================================

output "store_url" {
  description = "Endereço público da loja."
  value       = "http://${oci_core_instance.app.public_ip}"
}

output "app_public_ip" {
  description = "IP público da VM da aplicação."
  value       = oci_core_instance.app.public_ip
}

output "app_private_ip" {
  description = "IP privado da VM da aplicação."
  value       = oci_core_instance.app.private_ip
}

output "db_private_ip" {
  description = "IP privado da VM do MongoDB (sem IP público)."
  value       = oci_core_instance.db.private_ip
}

output "ssh_app" {
  description = "Comando SSH para a VM da aplicação."
  value       = "ssh ubuntu@${oci_core_instance.app.public_ip}"
}

output "ssh_db" {
  description = "Comando SSH para a VM do banco, passando pela VM da aplicação."
  value       = "ssh -J ubuntu@${oci_core_instance.app.public_ip} ubuntu@${oci_core_instance.db.private_ip}"
}

output "app_nsg_id" {
  description = "NSG da VM da aplicação (o pipeline abre nela, temporariamente, o SSH para o IP do runner)."
  value       = oci_core_network_security_group.app.id
}

output "mongo_device_path" {
  description = "Caminho do volume de dados dentro da VM do banco."
  value       = local.mongo_device_path
}

output "backup_bucket" {
  description = "Bucket que recebe os dumps do MongoDB."
  value       = oci_objectstorage_bucket.backups.name
}

output "backup_par_url" {
  description = "URL pré-autenticada do bucket de backups (SEGREDO)."
  value       = "https://objectstorage.${var.region}.oraclecloud.com${oci_objectstorage_preauthrequest.backups.access_uri}"
  sensitive   = true
}

output "inventory" {
  description = "Inventário dos recursos criados (critério ACE-02)."
  value = {
    vms = {
      app = {
        nome       = oci_core_instance.app.display_name
        shape      = oci_core_instance.app.shape
        ip_publico = oci_core_instance.app.public_ip
        ip_privado = oci_core_instance.app.private_ip
      }
      db = {
        nome       = oci_core_instance.db.display_name
        shape      = oci_core_instance.db.shape
        ip_publico = "nenhum"
        ip_privado = oci_core_instance.db.private_ip
      }
    }
    volume_dados_gb = oci_core_volume.mongo_data.size_in_gbs
    vcn             = oci_core_vcn.main.cidr_blocks[0]
    bucket_backups  = oci_objectstorage_bucket.backups.name
  }
}

output "ansible_inventory" {
  description = "Inventário pronto para o Ansible."
  value       = <<-EOT
    # Gerado por: terraform output -raw ansible_inventory
    [app]
    kubeshop-app ansible_host=${oci_core_instance.app.public_ip} private_ip=${oci_core_instance.app.private_ip}

    [db]
    kubeshop-db ansible_host=${oci_core_instance.db.private_ip} private_ip=${oci_core_instance.db.private_ip}

    [db:vars]
    ansible_ssh_common_args='-o ProxyCommand="ssh -o StrictHostKeyChecking=accept-new -W %h:%p -q ubuntu@${oci_core_instance.app.public_ip}"'

    [all:vars]
    ansible_user=ubuntu
  EOT
}

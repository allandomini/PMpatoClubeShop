# Relatório de validação — KubeShop

Este relatório reúne as evidências dos critérios de aceite do escopo (ACE-01 a ACE-10). Ele tem duas partes:

- **Parte A — validação local e estática:** já executada, com os resultados registrados abaixo.
- **Parte B — validação no Azure:** **pendente**. Precisa ser executada depois do `terraform apply`, com a saída de cada comando colada na seção correspondente.

> Regra: toda evidência deve ser a saída real de um comando ou registro de pipeline, com data e identificação da execução. Nenhuma saída pode conter senhas, chaves ou o `backup_par_url`.

---

## Parte A — Validação local e estática (executada)

**Data:** 25/11/2026 · **Máquina:** macOS (Apple Silicon), Docker Compose v5.7.0, Node.js 26.13 · **Branch:** `fix/backend-config`

### A1. Aplicação

| Verificação | Comando | Resultado |
|---|---|---|
| Testes unitários do backend | `npm run test:backend` | ✅ 9/9 |
| Testes unitários do frontend | `npm run test:frontend` | ✅ 8/8 |
| Build das imagens | `docker compose build` | ✅ api e web |
| Configuração do Nginx | `docker run --rm kubeshop-web nginx -t` | ✅ `syntax is ok` |

### A2. Execução de referência com Docker Compose

| Verificação | Comando | Resultado |
|---|---|---|
| Ambiente sobe com um comando | `node roteiros/setup.mjs` | ✅ mongo → api → web saudáveis, nessa ordem |
| Usuário da API criado com permissão restrita | `docker compose logs mongo` | ✅ `Usuário da aplicação criado em kubeshop.` |
| Fluxo completo (smoke) | `npm run smoke` | ✅ 7/7 (healthz, HTML com CSP, ready, 6 produtos, pedido 201, histórico, 400 para pedido inválido) |
| Navegador: loja sem erros de console/CSP | `npm run test:browser` | ✅ |
| Navegador: pedido aparece no histórico **após recarregar** | `npm run test:browser` | ✅ (ACE-04) |
| Persistência após `docker compose restart` | contagem em `/api/orders` | ✅ 2 → 2 pedidos |
| Persistência após recriar os containers | `docker compose up -d --force-recreate` | ✅ 2 pedidos |
| Só o Nginx é publicado | `docker compose ps` | ✅ `web: 127.0.0.1:8080`; api e mongo sem porta no host |
| Senhas fora de logs e de `docker inspect` | busca das senhas na saída | ✅ 0 ocorrências |

### A3. Backup e restauração (scripts reais da VM do banco, contra o Azurite)

Os scripts `kubeshop-backup` e `kubeshop-restore` foram executados num container Linux, contra um MongoDB 8.2.12 configurado como na VM e o **Azurite**, o emulador oficial do Azure Blob Storage. O token SAS foi gerado com o SDK `azure-storage-blob` (contém `&` e `%`) e o arquivo de configuração tem o mesmo formato gravado pela role do Ansible.

| Cenário | Resultado |
|---|---|
| Backup com envio ao contêiner do Blob Storage | ✅ `BACKUP_OK ... enviado=sim` |
| Listar o contêiner pela API de listagem (XML) | ✅ |
| Apagar os pedidos e o volume local; restaurar a partir do Blob | ✅ `RESTORE_OK documentos=3` → 3 pedidos |
| Restauração sem `--yes` | ✅ recusada |
| Nome de arquivo malicioso (`../../etc/passwd`) | ✅ recusado |
| Token SAS adulterado | ✅ o backup falha (`curl 22`, HTTP 403) e o token não aparece na saída |
| Token válido de novo | ✅ `enviado=sim` |
| `latest` ignora o backup de segurança `pre-restore` | ✅ |
| Desfazer uma restauração com o `kubeshop-pre-restore-*` | ✅ 3 → 0 pedidos |
| Retenção apaga dumps locais com mais de 7 dias | ✅ 1 removido |
| Senhas nos logs | ✅ 0 ocorrências |

### A4. Validação estática da infraestrutura e dos pipelines

| Ferramenta | Resultado |
|---|---|
| `terraform fmt -check` (Terraform 1.17.2) | ✅ |
| `terraform validate` (provider hashicorp/azurerm 5.15.0) | ✅ `The configuration is valid.` |
| `trivy config` (todas as severidades) | ✅ sem achados; os aceitos estão anotados no código com justificativa (README → Limitações) |
| `ansible-playbook --syntax-check site.yml backup.yml` (ansible-core 2.21.6) | ✅ |
| `ansible-lint --profile production` (26.11.1) | ✅ 0 falhas, 0 avisos |
| Templates do Compose das VMs renderizados + `docker compose config` | ✅ MongoDB em `127.0.0.1,10.20.2.10` com o `init.js`; API com `MONGO_HOST=10.20.2.10` |
| `shellcheck` (v0.10.0) nos scripts de backup, `setup.sh` e `acesso-ssh.sh` | ✅ |
| `actionlint` (1.7.9) nos 3 workflows | ✅ |
| Azure CLI 2.93.0: existência de todos os flags usados em `acesso-ssh.sh` e a consulta `starts_with` | ✅ |
| `acesso-ssh.sh` com `az` e `terraform` simulados (abrir, fechar, sem ambiente, argumento inválido) | ✅ 5 cenários |

**Não validado sem uma assinatura do Azure:** `terraform plan/apply` (o provedor só valida o esquema), o login do service principal, a criação das regras de NSG pelo pipeline, o firewall da conta de backups, o caminho `/dev/disk/azure/scsi1/lun0` do disco de dados e a rotina `desativar`. Tudo isso é exercitado na Parte B.

### Correções feitas no código recebido

| Arquivo | Problema | Efeito antes da correção |
|---|---|---|
| `backend/src/config.js` | continha uma cópia do catálogo, sem `readConfig` | a API não iniciava |
| `backend/test/package.json`, `test/Dockerfile` | estavam na pasta errada | build impossível |
| `frontend/src/App.jxs`, `Productart.jsx` | nomes errados | build e testes falhavam |
| `frontend/nginx.conf` | 8 erros de digitação (`acess_logs`, `;` faltando, `%uri`, `Content-Segurity-Policy`, ...) | Nginx não iniciava; a CSP nunca era aplicada |
| `frontend/src/App.test.jsx` | espaços não separáveis e textos esperados diferentes da tela | 4 testes falhavam |
| `docker/mongodb/healthcheck.js` | vazio na primeira versão; na versão da `main`, comparava `db.auth()` com `1`, mas o `mongosh` devolve `{ ok: 1 }` | sem verificação de saúde; depois, o MongoDB ficava sempre `unhealthy` e a stack não subia |
| ambos os apps | sem `package-lock.json` e `.dockerignore` | `npm ci` falhava no build |

### Revisão independente da troca para o Azure

Um revisor independente leu o diff e apontou um **bloqueio**, já corrigido: o firewall da conta de backups liberava só o IP do NAT Gateway, mas o Azure não aplica regras de IP a pedidos da mesma região, então todo envio da VM do banco ao Blob receberia HTTP 403. A correção foi um *service endpoint* `Microsoft.Storage` na sub-rede do banco, referenciado em `network_rules` (o Azurite não tem firewall e por isso não pegaria o erro). Também foram tratados: comentário desatualizado sobre trava do estado, senha do service principal começando com `-` no `az login`, e documentação da reimportação após `desativar`, da revogação do SAS e do `destroy` após `state rm`. Esses três últimos continuam **sem teste em uma assinatura real**.

---

## Parte B — Validação no Azure (pendente)

O caminho preferencial são os pipelines. O **link da execução** no GitHub Actions, com o resumo e o artefato de log, é a evidência de cada item:

| Critério | Execução no GitHub Actions |
|---|---|
| ACE-01, ACE-02 | Infra - operar → `planejar` e depois `provisionar` (o resumo mostra o inventário) |
| ACE-03, ACE-04 | Infra - operar → `verificar` (isolamento, endereços do MongoDB, smoke) |
| ACE-05 | alteração de infra: mude `db_vm_size` de `Standard_B2s` para `Standard_B2ms` → `planejar` → `provisionar`; depois `verificar` |
| ACE-06 | uma execução de `implantar-app`, de preferência chamada pelo CI/CD da aplicação |
| ACE-07 | Infra - backup agendado (verificar) + `backup` + `restaurar` |
| ACE-08 | histórico de execuções + artefatos `ansible-*`/`backup-*` (senhas aparecem como `***`) |

Os comandos abaixo são o equivalente manual. Execute-os na ordem, a partir da raiz do repositório, e cole as saídas indicadas. Preencha a tabela de identificação das execuções ao final.

### ACE-01 · Reprodução
```bash
az login && cd terraform && terraform init -backend-config=backend.hcl && terraform plan -out=kubeshop.tfplan && terraform apply kubeshop.tfplan
cd ../ansible && terraform -chdir=../terraform output -raw ansible_inventory > inventory.local.ini && ansible-playbook site.yml
```
Evidência: resumo do `apply` (`Apply complete! Resources: N added`) e o `PLAY RECAP` do Ansible com `failed=0`.

```
(pendente)
```

### ACE-02 · Duas VMs
```bash
terraform -chdir=terraform output inventory
```
```
(pendente)
```

### ACE-03 · Isolamento
```bash
ansible-playbook ansible/site.yml --tags verificar
nc -vz -w 5 <app_public_ip> 27017      # deve falhar (timeout/recusada)
az network nsg rule list -g kubeshop-rg --nsg-name kubeshop-nsg-db -o table   # mostra: só a app acessa a 27017, e o resto da VNet é negado
ansible db -a "ss -ltn sport = :27017"  # deve listar só 127.0.0.1 e 10.20.2.10
```
```
(pendente)
```

### ACE-04 · Aplicação
```bash
node roteiros/smoke.mjs http://<app_public_ip>
BASE_URL=http://<app_public_ip> npm run test:browser
```
Anexe também uma captura de tela da loja com o pedido no histórico.
```
(pendente)
```

### ACE-05 · Persistência após reinício e após alteração de infraestrutura
1. Anote a quantidade de pedidos: `curl -s http://<ip>/api/orders | jq '.orders | length'`.
2. Reinício: `ansible all -a "reboot" -B 1 -P 0`. Aguarde e repita a contagem.
3. **Alteração de infraestrutura:** mude `db_vm_size` de `Standard_B2s` para `Standard_B2ms` em `terraform.tfvars`, depois rode `terraform plan`, `terraform apply` e `ansible-playbook site.yml`. A VM do banco é redimensionada (reinicia) e o disco de dados é preservado. Repita a contagem.
```
(pendente)
```

### ACE-06 · CI/CD
Registro de uma execução do pipeline da aplicação implantando um commit (ver README → *Integração com o CI/CD*).
```
(pendente)
```

### ACE-07 · Recuperação
```bash
ansible db -a "systemctl list-timers kubeshop-backup.timer"   # agendamento ativo
ansible db -a "journalctl -u kubeshop-backup --no-pager -n 5" # execução automática (após 03:00)
ansible-playbook ansible/backup.yml                            # backup sob demanda
ansible-playbook ansible/backup.yml -e acao=restaurar -e confirmar=SIM
```
Evidência: `BACKUP_OK ... enviado=sim`, `RESTORE_OK ... documentos=N` e a contagem de pedidos pela API igual à anterior.
```
(pendente)
```

### ACE-08 · Administração
Registros (`PLAY RECAP`, saída do `plan`) das rotinas executadas; procedimento de desativação no README. Confirme que as senhas não aparecem:
```bash
grep -rE "$KUBESHOP_MONGO_ROOT_PASSWORD|$KUBESHOP_MONGO_APP_PASSWORD" <logs-das-execuções> | wc -l   # deve ser 0
```
```
(pendente)
```

### ACE-09 · Custos
Estimativa no README → *Estimativa de custos*. Confira os preços na calculadora oficial e registre aqui a data da conferência.

### ACE-10 · Transferência
README (operação, diagnóstico, desativação) e este relatório.

### Identificação das execuções

| Rotina | Data/hora | Quem/qual pipeline | ID da execução ou commit | Resultado |
|---|---|---|---|---|
| terraform apply | | | | |
| ansible site.yml | | | | |
| smoke na nuvem | | | | |
| alteração de infra (ACE-05) | | | | |
| backup automático | | | | |
| restauração | | | | |

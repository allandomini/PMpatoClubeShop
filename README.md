# KubeShop

Loja fictícia da Zibiska Korp: frontend React servido pelo Nginx, API Node.js/Express e MongoDB autenticado. Este repositório reúne a aplicação, a execução local com Docker Compose e a infraestrutura no **Microsoft Azure**, com **Terraform** para criar os recursos e **Ansible** para configurar e operar as VMs.

> Os pedidos são fictícios: não há login de clientes nem pagamento real.

## Sumário

1. [Arquitetura](#arquitetura)
2. [Estrutura do repositório](#estrutura-do-repositório)
3. [Execução local](#execução-local)
4. [Implantação no Azure](#implantação-no-azure)
5. [Pipelines de infraestrutura (GitHub Actions)](#pipelines-de-infraestrutura-github-actions)
6. [Operação do dia a dia](#operação-do-dia-a-dia)
7. [Ações que removem recursos ou dados](#ações-que-removem-recursos-ou-dados)
8. [Integração com o CI/CD da aplicação](#integração-com-o-cicd-da-aplicação)
9. [Decisões técnicas](#decisões-técnicas)
10. [Estimativa de custos](#estimativa-de-custos)
11. [Limitações conhecidas](#limitações-conhecidas)
12. [Diagnóstico de falhas comuns](#diagnóstico-de-falhas-comuns)

---

## Arquitetura

```
                Internet
                   │  HTTP 80 / HTTPS 443 (todos)      SSH 22 (somente admin_cidrs)
                   ▼
┌─────────────────────── VNet 10.20.0.0/16 (brazilsouth) ──────────────────────────┐
│                                                                                  │
│  Sub-rede "app" 10.20.1.0/24                                                     │
│  ┌──────────────────────────────────────────────┐                                │
│  │ VM kubeshop-app  (Standard_B2s, 2 vCPU/4 GB)  │                                │
│  │  container web: Nginx + React   :80 → :8080   │                                │
│  │  container api: Node.js/Express :3000 (interna)│                               │
│  └──────────────────────┬───────────────────────┘                                │
│                         │ TCP 27017 — somente a partir do grupo "app" (NSG)      │
│                         ▼                                                        │
│  Sub-rede "db" 10.20.2.0/24 (sem IP público)                                     │
│  ┌──────────────────────────────────────────────┐   ┌─────────────────────────┐  │
│  │ VM kubeshop-db   (Standard_B2s, 2 vCPU/4 GB)  │──▶│ Disco gerenciado 64 GB  │  │
│  │  container MongoDB 8.2 (auth) 10.20.2.10:27017│   │ /srv/mongodb (dados +   │  │
│  │  kubeshop-backup.timer (diário)               │   │ dumps locais)           │  │
│  └───────────────┬──────────────────────────────┘   └─────────────────────────┘  │
│                  │ NAT Gateway (atualizações e imagens, só saída)                │
└──────────────────┼───────────────────────────────────────────────────────────────┘
                   ▼
   Storage Account: contêiner "backups" (cópia externa dos dumps, via link SAS)
```

Fluxo da loja: o navegador acessa `http://IP_PUBLICO/`. O Nginx entrega o React e encaminha `/api/*` para a API, e **somente a API** fala com o MongoDB, pelo IP privado `10.20.2.10`.

| Requisito | Como é atendido |
|---|---|
| REQ-01 Servidores | 2 VMs (`kubeshop-app` e `kubeshop-db`), definidas em [terraform/main.tf](terraform/main.tf) |
| REQ-02 Banco isolado | MongoDB só na VM do banco, sem IP público, escutando em `127.0.0.1` e no IP privado |
| REQ-03 Rede privada | O NSG do banco aceita a porta 27017 **apenas** do grupo de segurança da app e nega o restante do tráfego interno da VNet |
| REQ-04 Acessos | SSH só por chave, a partir de `admin_cidrs`; o banco só é alcançado passando pela VM da app; segredos em variáveis de ambiente, com `no_log` |
| REQ-05 Persistência | Dados em disco gerenciado separado da VM (`prevent_destroy`), backups diários e cópia no Blob Storage |

## Estrutura do repositório

```
aplicativos/backend/     API Node.js/Express (+ testes, Dockerfile)
aplicativos/frontend/    React + Vite, Nginx (+ testes, Dockerfile, nginx.conf)
docker/mongodb/          scripts do MongoDB (usuário da API e verificação de saúde)
compose.yaml             execução local completa
.env.exemplo             variáveis da execução local (copie para .env)
roteiros/                setup.mjs/.sh/.ps1 (prepara e sobe) e smoke.mjs (teste rápido)
test/browser/            teste de navegador (Playwright)
terraform/               infraestrutura no Azure
ansible/                 configuração das VMs, implantação, backup e restauração
.github/                 pipelines (workflows) e ações compostas
VALIDAÇÃO.md             relatório de validação e evidências
```

## Execução local

Pré-requisitos: **Node.js 24.15+** e **Docker** com Compose v2.

```bash
node roteiros/setup.mjs
```

No Windows: `powershell -ExecutionPolicy Bypass -File roteiros\setup.ps1`. No Linux/macOS também funciona: `sh roteiros/setup.sh`.

O script confere os pré-requisitos, cria o `.env` com senhas aleatórias (sem mostrá-las), constrói as imagens, sobe os serviços e espera a loja responder em **http://localhost:8080**.

| Comando | O que faz |
|---|---|
| `npm run smoke` | teste rápido do fluxo completo (loja → catálogo → pedido → histórico) |
| `npm ci && npm run browser:install && npm run test:browser` | teste no navegador (Chromium) |
| `npm test` | testes unitários do backend e do frontend |
| `docker compose logs -f api` | logs da API |
| `docker compose down` | para os serviços (os pedidos ficam no volume `kubeshop_mongo-data`) |
| `docker compose down -v` | para **e apaga** os dados locais |

## Implantação no Azure

### Pré-requisitos (uma vez)

1. **Assinatura do Azure** com permissão de *Owner* ou *Contributor* (para criar recursos) e *User Access Administrator* (para dar papéis ao pipeline).
2. **Azure CLI** instalado: `az login` e `az account set --subscription <ID>`.
3. **Chave SSH** da equipe: `ssh-keygen -t ed25519`.
4. Ferramentas: Terraform ≥ 1.12 e Ansible ≥ 2.16 (`pipx install ansible-core`).
5. **Conta de armazenamento do estado do Terraform**, privada, com versionamento e recuperação de exclusão. O nome da conta é único em todo o Azure:
   ```bash
   az group create -n kubeshop-tfstate-rg -l brazilsouth
   az storage account create -g kubeshop-tfstate-rg -n <CONTA_UNICA> \
     --sku Standard_LRS --min-tls-version TLS1_2 --allow-blob-public-access false
   az storage account blob-service-properties update -g kubeshop-tfstate-rg --account-name <CONTA_UNICA> \
     --enable-versioning true --enable-delete-retention true --delete-retention-days 30
   az role assignment create --assignee "$(az ad signed-in-user show --query id -o tsv)" \
     --role "Storage Blob Data Contributor" \
     --scope "$(az storage account show -g kubeshop-tfstate-rg -n <CONTA_UNICA> --query id -o tsv)"
   az storage container create --account-name <CONTA_UNICA> -n tfstate --auth-mode login
   ```
   A atribuição do papel pode levar alguns minutos para valer.

### 1. Validar e planejar

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # preencha subscription_id, chave SSH, seu IP em admin_cidrs e o nome único da conta de backups
cat > backend.hcl <<'HCL'
resource_group_name  = "kubeshop-tfstate-rg"
storage_account_name = "<CONTA_UNICA>"
container_name       = "tfstate"
HCL
terraform init -backend-config=backend.hcl
terraform fmt -check && terraform validate
terraform plan -out=kubeshop.tfplan
```

Antes de aplicar, revise no `plan` o que será criado, alterado ou destruído.

### 2. Provisionar

```bash
terraform apply kubeshop.tfplan
terraform output inventory          # inventário das VMs (ACE-02)
```

Se aparecer `SkuNotAvailable` ou erro de cota, o tamanho da VM não está disponível na região ou na sua assinatura. Troque `app_vm_size`/`db_vm_size` ou a `location`; veja [Limitações](#limitações-conhecidas).

### 3. Configurar as VMs e implantar a aplicação

```bash
cd ../ansible
terraform -chdir=../terraform output -raw ansible_inventory > inventory.local.ini

# Segredos: gere uma vez e guarde no cofre da equipe / segredos do pipeline.
export KUBESHOP_MONGO_ROOT_PASSWORD='<senha longa>'
export KUBESHOP_MONGO_APP_PASSWORD='<outra senha longa>'
export KUBESHOP_BACKUP_SAS_URL="$(terraform -chdir=../terraform output -raw backup_sas_url)"

ansible-playbook site.yml
```

Para gerar uma senha forte: `openssl rand -base64 32`. Ao final, o playbook mostra o endereço da loja e confere duas coisas: que a porta 27017 **não** responde pelo IP público e que a app alcança o banco pela rede privada.

```bash
node ../roteiros/smoke.mjs "$(terraform -chdir=../terraform output -raw store_url)"
```

## Pipelines de infraestrutura (GitHub Actions)

Depois da configuração inicial abaixo, todas as rotinas do escopo rodam pela aba **Actions** do GitHub, sem precisar de nada instalado na máquina de quem opera. Cada execução fica registrada (log, resumo e artefato por 90 dias) como evidência, e as senhas aparecem como `***`.

| Workflow | Quando roda | O que faz |
|---|---|---|
| **Infra - validar** ([infra-validar.yml](.github/workflows/infra-validar.yml)) | todo PR e push na `main` | `terraform fmt/validate`, `ansible-lint`, `shellcheck` e a execução de referência local (Compose + smoke + navegador + persistência). Não usa segredos. |
| **Infra - operar** ([infra.yml](.github/workflows/infra.yml)) | manual (Run workflow) | `planejar`, `provisionar`, `configurar`, `implantar-app`, `verificar` e `desativar` |
| **Infra - backup** ([backup.yml](.github/workflows/backup.yml)) | todo dia às 07:00 e manual | confere se o backup automático da madrugada existe; sob demanda faz `backup`, `listar`, `verificar` ou `restaurar` |

### Ações de "Infra - operar"

| Ação | Etapas | Aprovação |
|---|---|---|
| `planejar` | `terraform plan`, com um resumo de quantos recursos serão criados, alterados e destruídos | não |
| `provisionar` | plan → **aprovação** → apply (só se o plano for igual ao aprovado) → Ansible completo → verificação | `producao` |
| `configurar` | Ansible completo (atualizações, configuração e serviços) → verificação | `producao` |
| `implantar-app` | nova versão da aplicação (`site.yml --tags app`) → verificação | `producao` |
| `verificar` | saúde, porta 27017 fechada pela internet, endereços em que o MongoDB escuta e smoke test | não |
| `desativar` | exige digitar `DESATIVAR` → **aprovação** → backup final → destrói VMs e rede, preservando o disco de dados e os backups | `producao-destrutivo` |

Duas operações nunca rodam ao mesmo tempo: todos os workflows de nuvem compartilham o mesmo grupo de concorrência, e o estado do Terraform também tem trava nativa (lease do Blob). O SSH das VMs aceita só `admin_cidrs`, então cada job abre no NSG uma regra temporária **apenas para o IP do runner** e a remove ao final, mesmo se o job falhar ([acesso-ssh.sh](.github/scripts/acesso-ssh.sh)).

### Configuração inicial (uma vez)

1. Siga os [pré-requisitos](#pré-requisitos-uma-vez) da implantação: assinatura, Azure CLI e a conta do estado do Terraform.
2. Crie o **service principal** do pipeline e anote a saída (`appId` é o client id, `password` é o client secret e `tenant` é o tenant id):
   ```bash
   SUB=$(az account show --query id -o tsv)
   az ad sp create-for-rbac --name kubeshop-pipeline --role Contributor --scopes "/subscriptions/$SUB"
   az role assignment create --assignee <appId> --role "Storage Blob Data Contributor" \
     --scope "$(az storage account show -g kubeshop-tfstate-rg -n <CONTA_UNICA> --query id -o tsv)"
   ```
   O papel *Contributor* na assinatura é necessário porque o Terraform cria o próprio grupo de recursos. Para restringir, crie o grupo `kubeshop-rg` antes, importe-o no estado e dê o papel só nele. O segredo do service principal tem validade (padrão de 1 ano): anote a data de vencimento.
3. Em **Settings → Secrets and variables → Actions**, cadastre:

   | Segredo (Secrets) | Valor |
   |---|---|
   | `AZURE_CLIENT_ID` | `appId` do service principal |
   | `AZURE_CLIENT_SECRET` | `password` do service principal |
   | `AZURE_TENANT_ID` | `tenant` do service principal |
   | `AZURE_SUBSCRIPTION_ID` | ID da assinatura |
   | `SSH_PRIVATE_KEY` | chave SSH privada da equipe |
   | `KUBESHOP_MONGO_ROOT_PASSWORD` | senha do administrador do MongoDB (`openssl rand -base64 32`) |
   | `KUBESHOP_MONGO_APP_PASSWORD` | senha do usuário da API |

   | Variável (Variables) | Exemplo |
   |---|---|
   | `TFSTATE_RESOURCE_GROUP` | `kubeshop-tfstate-rg` |
   | `TFSTATE_STORAGE_ACCOUNT` | nome único da conta do estado |
   | `TFSTATE_CONTAINER` | `tfstate` (padrão) |
   | `AZURE_LOCATION` | `brazilsouth` (padrão) |
   | `BACKUP_STORAGE_ACCOUNT` | nome único da conta de backups (3 a 24 letras minúsculas e números) |
   | `SSH_PUBLIC_KEY` | conteúdo da chave pública correspondente |
   | `ADMIN_CIDRS` | `["203.0.113.10/32"]` (IPs da equipe, em JSON) |

4. Em **Settings → Environments**, crie:
   - `producao`, com *Required reviewers*: quem aprova mudanças na nuvem;
   - `producao-destrutivo`, com *Required reviewers*, de preferência outra pessoa: aprova desativação e restauração;
   - `producao-leitura`, sem regras: usado pelas rotinas de backup que não alteram dados.
5. Rode **Infra - operar → `planejar`**, confira o resumo e depois rode **`provisionar`**.

Os mesmos comandos continuam funcionando na máquina local (seções anteriores), o que é útil para diagnóstico.

## Operação do dia a dia

As rotinas principais estão nos pipelines (seção anterior). Os comandos abaixo são o equivalente local, para diagnóstico. Rodam a partir de `ansible/`, com o inventário e as variáveis de ambiente da implantação. **Nenhum deles remove dados.**

| Rotina | Comando | Resultado esperado |
|---|---|---|
| Implantar nova versão da aplicação | `git pull && ansible-playbook site.yml --tags app` | `Versão: <commit>` e `Banco conectado: True` |
| Atualizar configuração/infra das VMs | `ansible-playbook site.yml` | só aplica o que mudou (`changed=`) |
| Conferir a saúde | `ansible-playbook site.yml --tags verificar` | loja pronta, 27017 fechada para a internet |
| Reiniciar a aplicação | `ansible app -a "docker compose -f /opt/kubeshop/compose.yaml restart"` | containers `api` e `web` reiniciados |
| Reiniciar o MongoDB | `ansible db -a "docker compose -f /opt/kubeshop-db/compose.yaml restart"` | API volta a `ready` em segundos |
| Logs da API | `ansible app -a "docker compose -f /opt/kubeshop/compose.yaml logs --tail=100 api"` | JSON por requisição (sem senhas) |
| Logs do Nginx | `ansible app -a "docker compose -f /opt/kubeshop/compose.yaml logs --tail=100 web"` | |
| Logs do MongoDB | `ansible db -a "docker logs --tail=100 kubeshop-mongo"` | |
| Logs do backup agendado | `ansible db -a "journalctl -u kubeshop-backup --since today --no-pager"` | linha `BACKUP_OK ...` |
| Backup agora | `ansible-playbook backup.yml` | `BACKUP_OK nome=... enviado=sim` |
| Listar backups | `ansible-playbook backup.yml -e acao=listar` | dumps locais e no Blob Storage |
| Próximo backup agendado | `ansible db -a "systemctl list-timers kubeshop-backup.timer"` | data do próximo disparo |

Acesso direto às VMs, se necessário: `terraform output ssh_app` e `terraform output ssh_db` (o banco é acessado passando pela VM da app).

### Atualização com falha: como voltar

- **Aplicação:** as 3 últimas versões ficam em `/opt/kubeshop/releases/`. Para voltar, faça checkout do commit anterior e rode `ansible-playbook site.yml --tags app`.
- **Infraestrutura:** o estado do Terraform fica em um contêiner versionado. Reverta o código (`git revert`), rode `terraform plan` e depois `terraform apply`. Se o estado se corromper, restaure a versão anterior do blob `kubeshop.tfstate` pelo portal do Azure ou com `az storage blob list --include v` e `az storage blob download --version-id`.

## Ações que removem recursos ou dados

Rode estas ações somente com intenção clara e, de preferência, com um backup recente.

| Ação | Comando | Efeito |
|---|---|---|
| Restaurar backup | `ansible-playbook backup.yml -e acao=restaurar -e confirmar=SIM` | **substitui** os pedidos atuais pelo dump mais recente; antes, faz um backup de segurança |
| Restaurar do Blob Storage | `... -e acao=restaurar -e origem=bucket -e arquivo=NOME -e confirmar=SIM` | idem, baixando o dump do contêiner |
| Desativar o ambiente | **Infra - operar → `desativar`** (ou o procedimento manual abaixo) | encerra as VMs e a rede |

Pelo pipeline, a restauração é **Infra - backup → `restaurar`**, com `confirmacao = SIM` e aprovação no ambiente `producao-destrutivo`.

### Desativação

**Pelo pipeline** (recomendado): rode **Infra - operar → `desativar`** e digite `DESATIVAR` em *confirmacao*. Depois da aprovação, o pipeline faz o backup final (se falhar, nada é destruído), tira do estado do Terraform o disco de dados, a conta de backups e o grupo de recursos, e destrói o restante. O resumo da execução lista o que continua na conta.

**Manualmente:**

1. Faça um backup final: `ansible-playbook backup.yml`.
2. Destrua os recursos. O disco de dados e a conta de backups têm `prevent_destroy`, então o Terraform se recusa a apagá-los. Escolha uma opção:
   - **Manter os dados:** `terraform state rm azurerm_managed_disk.mongo_data azurerm_storage_account.backups azurerm_storage_container.backups azurerm_resource_group.main` e depois `terraform destroy`. O grupo de recursos fica na conta com o disco e a conta de backups dentro. Eles podem ser reanexados ou apagados depois pelo portal.
   - **Apagar tudo:** remova os blocos `lifecycle { prevent_destroy = true }` do disco e da conta de backups em `main.tf` e rode `terraform destroy`.
3. O que **continua existindo** e pode gerar custo após o `destroy`:
   - o grupo de recursos `kubeshop-rg`, com o disco de dados e a conta de backups (na opção "manter os dados");
   - a conta de armazenamento do estado do Terraform (`kubeshop-tfstate-rg`), criada à mão e apagada à mão (`az group delete -n kubeshop-tfstate-rg`).

### Reprovisionar depois de desativar (mantendo os dados)

Depois de `desativar` (ou de um `state rm` manual), o grupo de recursos, o disco de dados e a conta de backups **ainda existem no Azure**, mas não estão mais no estado do Terraform. Um novo `provisionar` falharia com "a resource with the ID ... already exists" até que eles sejam importados de volta:

```bash
cd terraform
SUB=<ID da assinatura>; RG=kubeshop-rg; CONTA=<backup_storage_account>
terraform import azurerm_resource_group.main "/subscriptions/$SUB/resourceGroups/$RG"
terraform import azurerm_managed_disk.mongo_data "/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Compute/disks/kubeshop-mongo-data"
terraform import azurerm_storage_account.backups "/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Storage/storageAccounts/$CONTA"
terraform import azurerm_storage_container.backups "<ID do contêiner>"
terraform plan   # deve mostrar só a recriação de rede, VMs e do restante
```

O formato do ID do contêiner depende da versão do provedor: confira a seção *Import* de `azurerm_storage_container` na documentação do `azurerm` antes de importar. Este procedimento **não foi exercitado** em uma assinatura real. Depois do `apply` e do `site.yml`, o disco de dados é montado de volta pela role `mongodb` (ela só formata um disco vazio) e os pedidos voltam.

## Integração com o CI/CD da aplicação

O CI/CD da Zibiska Korp continua dono do **build e dos testes da aplicação**. A infraestrutura oferece dois pontos de integração:

| Item | Valor |
|---|---|
| Destino da implantação | VM `kubeshop-app`, diretório `/opt/kubeshop`, porta 80 (saída `store_url` do Terraform) |
| Ponto de entrada | workflow reutilizável **Infra - operar** com `acao: implantar-app`, que exige aprovação no ambiente `producao` |
| O que o CI/CD faz antes | `npm test` (unitários). Depois da implantação, o próprio workflow roda a verificação e o smoke test |
| Forma A (padrão) | o código do commit informado é enviado com `git archive` e as imagens são construídas na VM |
| Forma B (registro) | o CI/CD publica as imagens e a implantação recebe `-e app_use_registry_images=true -e app_api_image=<ref> -e app_web_image=<ref>` |

Exemplo de job no CI/CD da aplicação, no mesmo repositório:

```yaml
jobs:
  testes:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: "24" }
      - run: npm test

  implantar:
    needs: testes
    if: github.ref == 'refs/heads/main'
    uses: ./.github/workflows/infra.yml
    with:
      acao: implantar-app
      ref: ${{ github.sha }}
    secrets: inherit
```

Os segredos usados são os da tabela em [Configuração inicial](#configuração-inicial-uma-vez). Só os **nomes** ficam no repositório; os valores ficam no cofre de segredos do GitHub. Para implantar a partir de outro sistema de CI, os pontos de integração são os mesmos comandos de [Operação do dia a dia](#operação-do-dia-a-dia), com as variáveis `KUBESHOP_*` definidas e o login no Azure feito pelo service principal.

## Decisões técnicas

| Decisão | Justificativa |
|---|---|
| **Azure, região Brazil South (São Paulo)** | Mesma região do público, o que reduz a latência. Há alternativas mais baratas: `eastus2` tem VMs cerca de 38% mais baratas (US$ 0,0416 contra US$ 0,0672 por hora da `Standard_B2s`), ao custo de latência para o Brasil. A região é uma variável. |
| **VMs `Standard_B2s` (2 vCPU, 4 GB)** | Série B (*burstable*) atende a carga leve de uma loja fictícia por um preço baixo. 4 GB dão folga para construir as imagens na VM da aplicação e para o cache do MongoDB, que usa cerca de metade da RAM. A `Standard_B1ms` (2 GB, 50% mais barata) serve para a app se as imagens vierem de um registro. |
| **Disco de dados gerenciado e separado (Standard SSD, 64 GB)** | Os dados sobrevivem à troca ou recriação da VM do banco, o que permite demonstrar uma alteração de infraestrutura sem perder pedidos. Standard SSD basta para o volume de uma loja fictícia. |
| **NAT Gateway para a sub-rede do banco** | A VM do banco não tem IP público e precisa de saída para atualizar pacotes e baixar a imagem do MongoDB. Sem saída implícita no Azure, o NAT Gateway é a forma gerenciada de dar só saída. É a maior parcela de custo depois das VMs (veja a estimativa). |
| **NSGs com grupos de segurança de aplicação** | A regra do banco diz "somente do grupo da app", sem depender de IP, e uma regra explícita nega o resto do tráfego interno da VNet (o padrão do Azure liberaria). As regras são recursos separados, para o Terraform não apagar as regras temporárias do pipeline. |
| **Terraform (`azurerm`)** | Padrão de mercado, com `plan` antes de aplicar e estado remoto versionado, protegido por lease do Blob e acessado por Microsoft Entra ID, sem chaves de conta. |
| **Ansible** | Não exige agente nas VMs (só SSH), é idempotente e funciona igual na máquina da equipe e no pipeline. |
| **GitHub Actions para os pipelines** | O código já está no GitHub. Oferece aprovação por ambiente (*Required reviewers*), segredos mascarados nos logs, histórico de execuções como evidência e reutilização pelo CI/CD da aplicação (`workflow_call`). Não exige servidor próprio. |
| **SSH temporário para o runner** | Os runners mudam de IP; liberar o SSH para todos violaria o REQ-04. Uma regra por execução, removida ao final, mantém o acesso restrito. |
| **Docker Compose nas VMs** | Usa as mesmas imagens e o mesmo `nginx.conf` testados localmente, com reinício automático e healthchecks. |
| **Backups: `mongodump` diário no Blob Storage** | O dump é portátil e restaurável de forma seletiva e vai para fora da VM, em armazenamento LRS com recuperação de exclusão. |
| **Link SAS para o contêiner de backups** | Dispensa identidades dentro da VM. O link só dá acesso a esse contêiner, não permite apagar e vence na data de `backup_sas_expiry`. |
| **Firewall na conta de backups** | A conta só aceita conexões da sub-rede do banco (pelo *service endpoint* `Microsoft.Storage`, o único caminho que o Azure aceita para tráfego da mesma região, onde regras de IP não valem) e dos IPs em `backup_allowed_ips`. Um token SAS vazado não serve a quem está fora dessa lista. Esse tráfego também não passa pelo NAT Gateway. |
| **HTTP sem TLS, com DNS opcional** | O escopo não exige domínio. O IP público já pode ter um nome gratuito (`domain_name_label`). Com um domínio, basta apontar um registro para o IP e adicionar TLS (Let's Encrypt); a porta 443 já está liberada. |

## Estimativa de custos

**Premissas:** Microsoft Azure, região `brazilsouth`, preços de lista (pay-as-you-go) em **USD**, consultados na API pública *Azure Retail Prices* em **26/11/2026**, 730 horas por mês com tudo sempre ligado e tráfego de saída dentro dos 100 GB mensais gratuitos. Confira os valores atuais na [calculadora oficial](https://azure.microsoft.com/pricing/calculator/) antes de usar a estimativa para decisões.

| Item | Quantidade | Preço de lista | Custo mensal |
|---|---|---|---|
| VM app `Standard_B2s` (Linux) | 730 h | US$ 0,0672/h | US$ 49,06 |
| VM db `Standard_B2s` (Linux) | 730 h | US$ 0,0672/h | US$ 49,06 |
| Discos de sistema | 2 × Standard SSD E4 (32 GiB) | US$ 4,48 por disco | US$ 8,96 |
| Disco de dados do MongoDB | 1 × Standard SSD E6 (64 GiB) | US$ 8,96 | US$ 8,96 |
| IP público da aplicação | 1 IPv4 estático Standard | US$ 0,005/h | US$ 3,65 |
| NAT Gateway | 730 h | US$ 0,045/h | US$ 32,85 |
| IP público do NAT Gateway | 1 IPv4 estático Standard | US$ 0,005/h | US$ 3,65 |
| NAT Gateway: dados processados | ~5 GB (atualizações e imagens) | US$ 0,045/GB | ~US$ 0,23 |
| Blob Storage (dumps) | < 1 GB, LRS Hot | US$ 0,0326/GB | ~US$ 0,03 |
| NSGs, VNet, grupos de segurança de aplicação | — | sem cobrança | US$ 0,00 |
| Tráfego de saída | primeiros 100 GB/mês | grátis; acima, US$ 0,12/GB | US$ 0,00 |
| **Total** | | | **≈ US$ 156/mês** |

O disco de sistema da imagem do Ubuntu tem 30 GB e cai na faixa E4. O armazenamento do estado do Terraform (uma conta pequena em LRS) soma poucos centavos e não está na tabela.

**Créditos e faixas gratuitas (separados, como pede o escopo):** nenhum foi considerado. Contas novas do Azure costumam receber um crédito inicial por tempo limitado e algumas VMs gratuitas por 12 meses, mas as VMs gratuitas têm 1 GB de RAM, pequenas demais para este projeto. Verifique as condições atuais da sua assinatura. **O custo recorrente depois dos créditos é o total acima.**

**Onde reduzir:**
- Trocar a VM da aplicação para `Standard_B1ms` economiza cerca de US$ 24,50 por mês (US$ 0,0336 contra US$ 0,0672 por hora), desde que as imagens sejam construídas fora dela.
- O NAT Gateway pesa 23% do total (US$ 36,50 com o IP). Se a VM do banco puder ter um IP público fechado pelo NSG, ele sai da conta, mas o banco deixa de ser totalmente privado.
- Trocar a região para `eastus2` reduz as VMs em cerca de 38%. O preço dos discos e dos IPs nessa região não foi consultado.
- Desligar as VMs fora do horário (ou desativar o ambiente) interrompe a cobrança de computação, mas não a dos discos, IPs e NAT.

Fatores que mudam o custo: tamanho das VMs, mais tráfego de saída que 100 GB, mais dumps retidos, alta disponibilidade e domínio pago. A execução dos pipelines usa os minutos gratuitos do GitHub Actions para repositório público ou o plano da equipe.

## Limitações conhecidas

- **Capacidade e cota:** algumas regiões e assinaturas novas têm cota baixa ou restrição para certos tamanhos de VM (`SkuNotAvailable`, `QuotaExceeded`). Alternativas: outro tamanho da série B (`Standard_B2ms`, `Standard_B2ls_v2`), outra região ou pedir aumento de cota no portal.
- **Sem alta disponibilidade:** há uma instância de cada serviço, sem zonas de disponibilidade; uma falha da VM causa indisponibilidade até o reinício. O escopo pede o mínimo de 2 VMs.
- **Sem backup do disco inteiro:** a proteção dos dados é o `mongodump` diário (mais a recuperação de exclusão do Blob). Não há Azure Backup nem snapshot do disco, que seriam o próximo passo para recuperação rápida do disco completo.
- **Sem TLS:** o tráfego da loja é HTTP. Não há dados sensíveis (pedidos fictícios), mas o TLS deve ser o próximo passo com um domínio.
- **Baixar dumps à mão exige liberar seu IP:** a conta de backups nega qualquer origem fora da sub-rede do banco. Para baixar um dump do seu computador, acrescente seu IP em `backup_allowed_ips` e rode o pipeline (ou use `ansible-playbook backup.yml -e acao=restaurar`, que roda dentro da VM do banco).
- **Achados aceitos na análise de segurança:** o Trivy aponta, e o código registra com `#trivy:ignore` e justificativa, a loja aberta ao público (intencional), o IP público da VM da aplicação (intencional), o NSG na sub-rede e não na interface, e na conta de backups: sem logs de acesso, sem replicação geográfica e sem chave própria nem criptografia dupla (custo e escopo; os dados são criptografados pelo Azure e os dumps contêm só pedidos fictícios).
- **Firewall da conta de backups não foi exercitado no Azure:** o fluxo de envio e download com SAS foi validado no emulador Azurite, que não aplica regras de IP. A primeira execução real deve confirmar que o `terraform apply` e o primeiro backup passam com o firewall ligado.
- **O link SAS não pode ser revogado individualmente:** é um SAS de conta com chave (sem política de acesso armazenada), válido até `backup_sas_expiry` (padrão de 1 ano). Se vazar, só se revoga trocando a chave da conta (`az storage account keys renew`). Ele permite sobrescrever dumps (a recuperação de exclusão de 7 dias ameniza) e a chave da conta fica no estado do Terraform, que por isso é privado e acessado só por Microsoft Entra ID. O firewall da conta limita quem consegue usar um token vazado.
- **Segredo do service principal e link SAS vencem:** o segredo do pipeline (padrão de 1 ano) e o link SAS dos backups (`backup_sas_expiry`) precisam ser renovados antes do vencimento. Um link vencido faz o backup ficar com `enviado=nao`.
- **Papel amplo do pipeline:** o service principal é *Contributor* na assinatura, porque o Terraform cria o grupo de recursos. Dá para restringir ao grupo se ele for criado antes.
- **Trocar as senhas do MongoDB** depois da criação não altera os usuários existentes: é preciso alterá-las também no banco (`db.changeUserPassword`).
- **Desativação pelo pipeline não foi exercitada na nuvem:** a rotina que tira o disco, a conta de backups e o grupo de recursos do estado antes do `destroy` só foi validada na sintaxe. Em especial, não foi confirmado que o `terraform destroy` aceita a fonte de dados do token SAS e as saídas, que apontam para recursos que acabaram de sair do estado. Teste-a primeiro em um ambiente descartável.

## Diagnóstico de falhas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Loja não abre, mas a VM está no ar | container `web` parado ou regra do NSG removida | `ansible-playbook site.yml`; depois `ansible app -a "docker compose -f /opt/kubeshop/compose.yaml ps"`; confira as regras do NSG `kubeshop-nsg-app` |
| Loja abre e mostra "Loja indisponível" | API sem acesso ao banco | `curl http://IP/api/health/ready`; se `database:false`, veja os logs do MongoDB e se a VM do banco está no ar |
| `/api/health/ready` retorna 503 logo após reiniciar | API ainda conectando (tenta a cada 2 s) | aguarde ~30 s |
| Ansible não conecta no banco | sem acesso pela VM da app (ProxyCommand) | teste `ssh ubuntu@<app_public_ip>`; confira se seu IP está em `admin_cidrs` |
| `Defina KUBESHOP_MONGO_..._PASSWORD` | variáveis de ambiente ausentes | exporte as variáveis antes de rodar o playbook |
| `terraform apply`: `MissingSubscriptionRegistration` | provedor de recursos não registrado na assinatura | `az provider register -n Microsoft.Compute`, repita para `Microsoft.Network` e `Microsoft.Storage` |
| `terraform apply`: `StorageAccountAlreadyTaken` | o nome da conta de backups já existe no Azure | escolha outro valor em `backup_storage_account` |
| Backup com `enviado=nao` ou erro `403` | `KUBESHOP_BACKUP_SAS_URL` não definido, link vencido, ou IP fora da lista da conta | defina a variável e rode `site.yml --tags db`; renove o link alterando `backup_sas_expiry`; confira se a sub-rede `db` tem o service endpoint `Microsoft.Storage` e se a conta de backups ainda lista essa sub-rede |
| "Infra - backup" agendado falhou | o backup da madrugada não aconteceu | veja `journalctl -u kubeshop-backup` na VM do banco e rode **Infra - backup → `backup`** |
| Pipeline: `O SSH não respondeu a tempo` | VM da app desligada ou regra temporária não aplicada | confira a VM no portal; rode de novo (a regra antiga é removida no início e ao final de todo job) |
| Pipeline: login no Azure falha | segredo do service principal vencido ou errado | gere outro com `az ad sp credential reset` e atualize `AZURE_CLIENT_SECRET` |
| Pipeline: `O plano mudou desde a aprovação` | algo mudou entre o `plan` e o `apply` | rode `planejar` de novo e aprove o novo plano |
| `terraform destroy` falha no disco ou na conta de backups | `prevent_destroy` (proteção intencional) | veja [Desativação](#desativação) |

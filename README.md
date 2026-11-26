# KubeShop

Loja fictícia da Zibiska Korp: frontend React servido pelo Nginx, API Node.js/Express e MongoDB autenticado. Este repositório reúne a aplicação, a execução local com Docker Compose e a infraestrutura na **Oracle Cloud (OCI)**, com **Terraform** para criar os recursos e **Ansible** para configurar e operar as VMs.

> Os pedidos são fictícios: não há login de clientes nem pagamento real.

## Sumário

1. [Arquitetura](#arquitetura)
2. [Estrutura do repositório](#estrutura-do-repositório)
3. [Execução local](#execução-local)
4. [Implantação na Oracle Cloud](#implantação-na-oracle-cloud)
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
                   │  HTTP 80 (todos)      SSH 22 (somente admin_cidrs)
                   ▼
┌──────────────────────── VCN 10.20.0.0/16 (sa-saopaulo-1) ────────────────────────┐
│                                                                                  │
│  Sub-rede pública 10.20.1.0/24                                                   │
│  ┌──────────────────────────────────────────────┐                                │
│  │ VM kubeshop-app  (A1.Flex 1 OCPU / 6 GB)      │                                │
│  │  container web: Nginx + React   :80 → :8080   │                                │
│  │  container api: Node.js/Express :3000 (interna)│                               │
│  └──────────────────────┬───────────────────────┘                                │
│                         │ TCP 27017 — somente a partir da NSG da app             │
│                         ▼                                                        │
│  Sub-rede privada 10.20.2.0/24 (sem IP público)                                  │
│  ┌──────────────────────────────────────────────┐   ┌─────────────────────────┐  │
│  │ VM kubeshop-db   (A1.Flex 1 OCPU / 6 GB)      │──▶│ Volume em bloco 50 GB   │  │
│  │  container MongoDB 8.2 (auth) 10.20.2.10:27017│   │ /srv/mongodb (dados +   │  │
│  │  kubeshop-backup.timer (diário)               │   │ dumps locais)           │  │
│  └───────────────┬──────────────────────────────┘   └─────────────────────────┘  │
│                  │ NAT (atualizações)   Service Gateway (backups)                │
└──────────────────┼───────────────────────────────────────────────────────────────┘
                   ▼
        Object Storage: bucket kubeshop-backups (cópia externa dos dumps)
```

Fluxo da loja: o navegador acessa `http://IP_PUBLICO/`. O Nginx entrega o React e encaminha `/api/*` para a API, e **somente a API** fala com o MongoDB, pelo IP privado `10.20.2.10`.

| Requisito | Como é atendido |
|---|---|
| REQ-01 Servidores | 2 VMs (`kubeshop-app` e `kubeshop-db`), definidas em [terraform/main.tf](terraform/main.tf) |
| REQ-02 Banco isolado | MongoDB só na VM do banco, sem IP público, escutando em `127.0.0.1` e no IP privado |
| REQ-03 Rede privada | NSG do banco aceita a porta 27017 **apenas** da NSG da app; firewall local aceita só o IP da app |
| REQ-04 Acessos | SSH só por chave, a partir de `admin_cidrs`; o banco só é alcançado passando pela VM da app; segredos em variáveis de ambiente, com `no_log` |
| REQ-05 Persistência | Dados em volume em bloco separado da VM (`prevent_destroy`), backups diários e cópia no Object Storage |

## Estrutura do repositório

```
aplicativos/backend/     API Node.js/Express (+ testes, Dockerfile)
aplicativos/frontend/    React + Vite, Nginx (+ testes, Dockerfile, nginx.conf)
docker/mongodb/          scripts do MongoDB (usuário da API e verificação de saúde)
compose.yaml             execução local completa
.env.exemplo             variáveis da execução local (copie para .env)
roteiros/                setup.mjs/.sh/.ps1 (prepara e sobe) e smoke.mjs (teste rápido)
test/browser/            teste de navegador (Playwright)
terraform/               infraestrutura na Oracle Cloud
ansible/                 configuração das VMs, implantação, backup e restauração
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

## Implantação na Oracle Cloud

### Pré-requisitos (uma vez)

1. **Conta OCI** e um compartimento para o projeto.
2. **Chave de API** do usuário OCI (Perfil → Chaves de API), configurada em `~/.oci/config`.
3. **Chave SSH** da equipe (`ssh-keygen -t ed25519`).
4. Ferramentas: Terraform ≥ 1.12, Ansible ≥ 2.16 (`pipx install ansible-core`) e o OCI CLI (para criar o bucket do estado).
5. **Bucket do estado do Terraform**, privado e com versionamento:
   ```bash
   oci os bucket create --name kubeshop-tfstate --compartment-id <COMPARTMENT_OCID> --versioning Enabled
   ```
6. **Customer Secret Key** (Perfil → Chaves secretas do cliente), para o Terraform acessar o bucket do estado pela API compatível com S3:
   ```bash
   export AWS_ACCESS_KEY_ID=<access key>
   export AWS_SECRET_ACCESS_KEY=<secret key>
   ```

### 1. Validar e planejar

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # preencha OCIDs, chave SSH e seu IP em admin_cidrs
cat > backend.hcl <<'EOF'
bucket    = "kubeshop-tfstate"
region    = "sa-saopaulo-1"
endpoints = { s3 = "https://<NAMESPACE>.compat.objectstorage.sa-saopaulo-1.oraclecloud.com" }
EOF
terraform init -backend-config=backend.hcl
terraform fmt -check && terraform validate
terraform plan -out=kubeshop.tfplan
```

O namespace aparece com `oci os ns get`. Antes de aplicar, revise no `plan` o que será criado, alterado ou destruído.

### 2. Provisionar

```bash
terraform apply kubeshop.tfplan
terraform output inventory          # inventário das VMs (ACE-02)
```

Se aparecer `Out of host capacity`, a região está sem VMs ARM gratuitas no momento. Tente de novo mais tarde ou mude `instance_shape`; veja [Limitações](#limitações-conhecidas).

### 3. Configurar as VMs e implantar a aplicação

```bash
cd ../ansible
terraform -chdir=../terraform output -raw ansible_inventory > inventory.local.ini

# Segredos: gere uma vez e guarde no cofre da equipe / segredos do pipeline.
export KUBESHOP_MONGO_ROOT_PASSWORD='<senha longa>'
export KUBESHOP_MONGO_APP_PASSWORD='<outra senha longa>'
export KUBESHOP_BACKUP_PAR_URL="$(terraform -chdir=../terraform output -raw backup_par_url)"

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
| `desativar` | exige digitar `DESATIVAR` → **aprovação** → backup final → destrói VMs e rede, preservando o volume de dados e os backups | `producao-destrutivo` |

Duas operações nunca rodam ao mesmo tempo: todos os workflows de nuvem compartilham o mesmo grupo de concorrência. O SSH das VMs aceita só `admin_cidrs`, então cada job abre na NSG uma regra temporária **apenas para o IP do runner** e a remove ao final, mesmo se o job falhar ([acesso-ssh.sh](.github/scripts/acesso-ssh.sh)).

### Configuração inicial (uma vez)

1. Siga os [pré-requisitos](#pré-requisitos-uma-vez) da implantação: conta, chave de API, bucket do estado e Customer Secret Key.
2. Em **Settings → Secrets and variables → Actions**, cadastre:

   | Segredo (Secrets) | Valor |
   |---|---|
   | `OCI_TENANCY_OCID` | OCID da tenancy |
   | `OCI_COMPARTMENT_OCID` | OCID do compartimento |
   | `OCI_USER_OCID` | OCID do usuário da chave de API |
   | `OCI_FINGERPRINT` | fingerprint da chave de API |
   | `OCI_PRIVATE_KEY` | conteúdo do arquivo `.pem` da chave de API |
   | `OCI_STATE_ACCESS_KEY` / `OCI_STATE_SECRET_KEY` | Customer Secret Key (bucket do estado) |
   | `SSH_PRIVATE_KEY` | chave SSH privada da equipe |
   | `KUBESHOP_MONGO_ROOT_PASSWORD` | senha do administrador do MongoDB (`openssl rand -base64 32`) |
   | `KUBESHOP_MONGO_APP_PASSWORD` | senha do usuário da API |

   | Variável (Variables) | Exemplo |
   |---|---|
   | `OCI_NAMESPACE` | saída de `oci os ns get` |
   | `OCI_REGION` | `sa-saopaulo-1` (padrão) |
   | `OCI_STATE_BUCKET` | `kubeshop-tfstate` (padrão) |
   | `SSH_PUBLIC_KEY` | conteúdo da chave pública correspondente |
   | `ADMIN_CIDRS` | `["203.0.113.10/32"]` (IPs da equipe, em JSON) |

3. Em **Settings → Environments**, crie:
   - `producao`, com *Required reviewers*: quem aprova mudanças na nuvem;
   - `producao-destrutivo`, com *Required reviewers*, de preferência outra pessoa: aprova desativação e restauração;
   - `producao-leitura`, sem regras: usado pelas rotinas de backup que não alteram dados.
4. Rode **Infra - operar → `planejar`**, confira o resumo e depois rode **`provisionar`**.

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
| Listar backups | `ansible-playbook backup.yml -e acao=listar` | dumps locais e no bucket |
| Próximo backup agendado | `ansible db -a "systemctl list-timers kubeshop-backup.timer"` | data do próximo disparo |

Acesso direto às VMs, se necessário: `terraform output ssh_app` e `terraform output ssh_db` (o banco é acessado passando pela VM da app).

### Atualização com falha: como voltar

- **Aplicação:** as 3 últimas versões ficam em `/opt/kubeshop/releases/`. Para voltar, faça checkout do commit anterior e rode `ansible-playbook site.yml --tags app`.
- **Infraestrutura:** o estado do Terraform fica no bucket versionado. Reverta o código (`git revert`), rode `terraform plan` e depois `terraform apply`. Se o estado se corromper, restaure a versão anterior do objeto `kubeshop/terraform.tfstate` no bucket `kubeshop-tfstate`.

## Ações que removem recursos ou dados

Rode estas ações somente com intenção clara e, de preferência, com um backup recente.

| Ação | Comando | Efeito |
|---|---|---|
| Restaurar backup | `ansible-playbook backup.yml -e acao=restaurar -e confirmar=SIM` | **substitui** os pedidos atuais pelo dump mais recente; antes, faz um backup de segurança |
| Restaurar do bucket | `... -e acao=restaurar -e origem=bucket -e arquivo=NOME -e confirmar=SIM` | idem, baixando o dump do Object Storage |
| Desativar o ambiente | **Infra - operar → `desativar`** (ou o procedimento manual abaixo) | encerra as VMs e a rede |

Pelo pipeline, a restauração é **Infra - backup → `restaurar`**, com `confirmacao = SIM` e aprovação no ambiente `producao-destrutivo`.

### Desativação

**Pelo pipeline** (recomendado): rode **Infra - operar → `desativar`** e digite `DESATIVAR` em *confirmacao*. Depois da aprovação, o pipeline faz o backup final (se falhar, nada é destruído), tira o volume de dados e o bucket de backups do estado do Terraform e destrói o restante. O resumo da execução lista o que continua na conta.

**Manualmente:**

1. Faça um backup final: `ansible-playbook backup.yml`.
2. Destrua os recursos. O volume de dados tem `prevent_destroy`, então o Terraform se recusa a apagá-lo. Escolha uma opção:
   - **Manter os dados:** `terraform state rm oci_core_volume.mongo_data oci_core_volume_attachment.mongo_data 'oci_core_volume_backup_policy_assignment.mongo_data[0]' oci_objectstorage_bucket.backups` e depois `terraform destroy`. O volume continua na conta e pode ser reanexado ou apagado depois pelo console.
   - **Apagar tudo:** remova o bloco `lifecycle { prevent_destroy = true }` do volume em `main.tf` e rode `terraform destroy`.
3. O que **continua existindo** e pode gerar custo após o `destroy`:
   - bucket `kubeshop-backups` com os dumps: o Terraform só o apaga se estiver vazio;
   - bucket `kubeshop-tfstate` com o estado: é criado à mão e apagado à mão;
   - backups do volume feitos pela política *bronze*;
   - o volume de dados, na opção "manter os dados".

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

Os segredos usados são os da tabela em [Configuração inicial](#configuração-inicial-uma-vez). Só os **nomes** ficam no repositório; os valores ficam no cofre de segredos do GitHub. Para implantar a partir de outro sistema de CI, os pontos de integração são os mesmos comandos de [Operação do dia a dia](#operação-do-dia-a-dia), com as variáveis `KUBESHOP_*` definidas.

## Decisões técnicas

| Decisão | Justificativa |
|---|---|
| **Oracle Cloud, região São Paulo** | O *Always Free* inclui até 4 OCPUs ARM e 24 GB de RAM, 200 GB de disco e 20 GB de Object Storage, o que cobre as duas VMs sem custo recorrente. São Paulo reduz a latência para o público brasileiro. |
| **VM.Standard.A1.Flex, 1 OCPU / 6 GB cada** | A app (Nginx + Node) e o MongoDB com poucos dados cabem com folga. O MongoDB usa ~50% da RAM para cache, então 6 GB evita pressão de memória. O tamanho é ajustável por variável, sem recriar o resto. |
| **Volume em bloco separado para o MongoDB** | Os dados sobrevivem à troca ou recriação da VM do banco, o que permite demonstrar uma alteração de infraestrutura sem perder pedidos. |
| **Terraform** | Padrão de mercado, com provider oficial da Oracle, `plan` antes de aplicar e estado remoto versionado. |
| **Ansible** | Não exige agente nas VMs (só SSH), é idempotente e funciona igual na máquina da equipe e no pipeline. |
| **GitHub Actions para os pipelines** | O código já está no GitHub. Oferece aprovação por ambiente (*Required reviewers*), segredos mascarados nos logs, histórico de execuções como evidência e reutilização pelo CI/CD da aplicação (`workflow_call`). Não exige servidor próprio. |
| **SSH temporário para o runner** | Os runners mudam de IP; liberar o SSH para todos violaria o REQ-04. Uma regra por execução, removida ao final, mantém o acesso restrito. |
| **Docker Compose nas VMs** | Usa as mesmas imagens e o mesmo `nginx.conf` testados localmente, com reinício automático e healthchecks. |
| **Backups: `mongodump` diário + política *bronze* do volume** | O dump é portátil e restaurável de forma seletiva; a cópia do volume protege contra perda do disco. O dump vai também ao Object Storage, fora da VM. |
| **Link pré-autenticado (PAR) para o bucket** | Dispensa usuários e políticas IAM dentro da VM. O link só dá acesso a esse bucket e expira (`backup_par_expires`). |
| **HTTP sem TLS e sem DNS** | O escopo não exige domínio. Com um domínio, basta apontar um registro A para `app_public_ip` e adicionar TLS (Let's Encrypt). A porta 443 já está liberada. |

## Estimativa de custos

**Premissas:** Oracle Cloud, região `sa-saopaulo-1`, preços de lista em **USD** (pay-as-you-go), referência de 25/11/2026, 730 horas por mês com as VMs sempre ligadas e tráfego de saída abaixo de 10 TB por mês. Confira os valores atuais na [calculadora oficial](https://www.oracle.com/cloud/costestimator.html) antes de usar a estimativa para decisões.

| Item | Quantidade | Preço de lista | Custo mensal sem Free Tier |
|---|---|---|---|
| VM app (A1.Flex) | 1 OCPU + 6 GB, 730 h | US$ 0,01/OCPU-h + US$ 0,0015/GB-h | US$ 13,87 |
| VM db (A1.Flex) | 1 OCPU + 6 GB, 730 h | idem | US$ 13,87 |
| Discos de sistema | 2 × 50 GB (Balanced) | US$ 0,0255/GB + 10 VPU × US$ 0,0017/GB | US$ 4,25 |
| Volume de dados MongoDB | 50 GB (Balanced) | idem | US$ 2,13 |
| Backups do volume (*bronze*) | ~1 GB incremental | US$ 0,0255/GB | ~US$ 0,03 |
| Object Storage (dumps) | < 1 GB | US$ 0,0255/GB | < US$ 0,03 |
| IPs públicos efêmeros, NAT, Service Gateway, VCN | — | sem cobrança | US$ 0,00 |
| Tráfego de saída | < 10 TB | primeiros 10 TB/mês grátis | US$ 0,00 |
| **Total sem Free Tier** | | | **≈ US$ 34/mês** |

**Com o Always Free (separado, como pede o escopo):** 2 OCPU e 12 GB ficam dentro do limite gratuito de 4 OCPU e 24 GB. Os 150 GB de disco ficam dentro de 200 GB, os backups do volume dentro de 5 e o Object Storage dentro de 20 GB. **O custo recorrente esperado é US$ 0,00.** Se a conta perder o Free Tier, o custo passa a ser o total acima.

Fatores que mudam o custo: aumentar OCPU ou RAM (custo linear), reter mais dumps, passar de 10 TB de tráfego, adicionar balanceador de carga ou domínio pago. A execução dos pipelines usa os minutos gratuitos do GitHub Actions para repositório público ou do plano da equipe.

## Limitações conhecidas

- **Capacidade ARM no Free Tier:** em horários de pico, a região pode recusar novas VMs A1 (`Out of host capacity`). Alternativas: tentar de novo mais tarde ou usar `VM.Standard.E2.1.Micro` (AMD, 1 GB, também gratuita), que é pequena demais para o MongoDB 8 com folga.
- **Sem alta disponibilidade:** há uma instância de cada serviço; uma falha da VM causa indisponibilidade até o reinício. O escopo pede o mínimo de 2 VMs.
- **Sem TLS:** o tráfego da loja é HTTP. Não há dados sensíveis (pedidos fictícios), mas o TLS deve ser o próximo passo com um domínio.
- **Trocar as senhas do MongoDB** depois da criação não altera os usuários existentes: é preciso alterá-las também no banco (`db.changeUserPassword`).
- **Estado do Terraform sem trava:** não rode `apply` em paralelo; o pipeline deve serializar as execuções.

## Diagnóstico de falhas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Loja não abre, mas a VM está no ar | firewall local da imagem Oracle ou container `web` parado | `ansible-playbook site.yml`; depois `ansible app -a "docker compose -f /opt/kubeshop/compose.yaml ps"` |
| Loja abre e mostra "Loja indisponível" | API sem acesso ao banco | `curl http://IP/api/health/ready`; se `database:false`, veja os logs do MongoDB e se a VM do banco está no ar |
| `/api/health/ready` retorna 503 logo após reiniciar | API ainda conectando (tenta a cada 2 s) | aguarde ~30 s |
| Ansible não conecta no banco | sem acesso pela VM da app (ProxyCommand) | teste `ssh ubuntu@<app_public_ip>`; confira se seu IP está em `admin_cidrs` |
| `Defina KUBESHOP_MONGO_..._PASSWORD` | variáveis de ambiente ausentes | exporte as variáveis antes de rodar o playbook |
| Backup com `enviado=nao` | `KUBESHOP_BACKUP_PAR_URL` não definido ou link expirado | defina a variável e rode `site.yml --tags db`; renove o link alterando `backup_par_expires` |
| "Infra - backup" agendado falhou | o backup da madrugada não aconteceu | veja `journalctl -u kubeshop-backup` na VM do banco e rode **Infra - backup → `backup`** |
| Pipeline: `O SSH não respondeu a tempo` | VM da app desligada ou regra temporária não aplicada | confira a VM no console; rode de novo (a regra antiga é removida ao final de todo job) |
| Pipeline: `O plano mudou desde a aprovação` | algo mudou entre o `plan` e o `apply` | rode `planejar` de novo e aprove o novo plano |
| `terraform destroy` falha no volume | `prevent_destroy` (proteção intencional) | veja [Desativação](#desativação) |

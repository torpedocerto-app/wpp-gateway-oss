# 09 — Infraestrutura AWS e Deploy

**Provedor:** AWS · **Região:** `us-east-1` (N. Virginia) · **Compute:** EC2 `t4g.medium`

---

## 1. Decisões de infraestrutura

### 1.1 EC2 em vez de Fargate

| Critério | EC2 | Fargate |
|---|---|---|
| Filesystem persistente | ✅ EBS nativo | ❌ Exige EFS (mais caro e lento) |
| Instância única garantida | ✅ Trivial | ⚠️ Rescheduling pode duplicar/mover task |
| Custo rodando 24/7 | ~US$24/mês | ~US$35-40/mês |
| Reconexão de sessões | Só em deploy do worker | A cada rescheduling |

> **O motivo decisivo não é custo, é arquitetura.** As sessões Baileys são WebSockets
> persistentes com credenciais em disco, e o worker precisa ser instância única
> (ADR-002). Fargate é projetado para o oposto: containers efêmeros e escaláveis.
> Cada rescheduling de task reconectaria todas as contas — e reconexão frequente é
> o principal fator de risco de banimento. Fargate ainda sai **mais caro** rodando
> 24/7, porque você paga o prêmio do serverless sem usar a elasticidade.

**ADR-005 — EC2 On-Demand, sem auto-stop.** A instância roda 24/7 sem interrupção.
Spot Instances estão **descartadas**: a AWS pode encerrá-las a qualquer momento, o que
derrubaria todas as sessões WhatsApp. Não existe cenário de "desligar quando ocioso"
neste projeto.

### 1.2 PostgreSQL em container, não no RDS MySQL existente

O RDS MySQL da holding foi avaliado e **descartado** por incompatibilidade com o
modelo de dados (doc 02), não por custo:

| Recurso usado | Postgres | MySQL |
|---|---|---|
| Particionamento por mês com `DROP PARTITION` | ✅ Nativo, retenção instantânea | ⚠️ `DELETE` lento, não devolve espaço |
| Índice único parcial (`WHERE external_id IS NOT NULL`) | ✅ Nativo — base da idempotência | ❌ Inexistente; exige workaround frágil |
| `JSONB` indexável | ✅ | ⚠️ JSON sem índice funcional equivalente |

O Postgres roda como container na própria EC2 — **custo adicional zero**. O volume
real do projeto (~700 mensagens/dia) é trivial para uma instância local.

**ADR-006 — Postgres containerizado na EC2.** Consequência: o backup é
responsabilidade da aplicação (não gerenciado como no RDS). Mitigado pela rotina
automatizada da §6. Migrar para RDS PostgreSQL depois é simples se o volume crescer.

### 1.3 Região us-east-1

Escolhida por custo e disponibilidade de serviços.

> ⚠️ **Risco aceito e registrado:** contas com DDD brasileiro conectando
> consistentemente de IP norte-americano é uma inconsistência que a Meta pode
> correlacionar. `sa-east-1` (São Paulo) eliminaria esse sinal por ~US$4-5/mês a mais.
> A migração posterior é simples (snapshot AMI + relaunch em outra região) caso a
> taxa de banimento se mostre alta. Ver `06-anti-ban.md`.

---

## 2. Arquitetura AWS

```
                        Internet
                            │
                    ┌───────▼────────┐
                    │  Elastic IP    │  ⚠️ IP fixo obrigatório
                    └───────┬────────┘
                            │
        ┌───────────────────▼────────────────────┐
        │  Security Group: wpp-sg                │
        │  IN : 443, 80 (0.0.0.0/0)              │
        │  IN : 22 → ❌ FECHADO (usa SSM)        │
        └───────────────────┬────────────────────┘
                            │
    ┌───────────────────────▼─────────────────────────┐
    │  EC2 t4g.medium (ARM Graviton) — us-east-1      │
    │  Amazon Linux 2023 · 2 vCPU · 4 GB              │
    │  ┌───────────────────────────────────────────┐  │
    │  │  Docker Compose                           │  │
    │  │  caddy · api · panel · worker             │  │
    │  │  postgres · redis                         │  │
    │  └───────────────────────────────────────────┘  │
    │  EBS gp3 50 GB (encrypted)                      │
    │    /var/lib/docker/volumes/  ← sessões + dados  │
    └──────┬───────────────────┬──────────────────────┘
           │                   │
           │ IAM Role          │ backup diário
           ▼                   ▼
    ┌─────────────┐     ┌──────────────────┐
    │ SSM + ECR   │     │ S3: wpp-backups  │
    │ CloudWatch  │     │ + lifecycle      │
    │ Secrets Mgr │     │ + versionamento  │
    └─────────────┘     └──────────────────┘
```

---

## 3. Provisionamento via AWS CLI

### 3.1 Variáveis base

```bash
export AWS_REGION=us-east-1
export PROJECT=wpp-gateway
export KEY_NAME=${PROJECT}-key
```

### 3.2 Security Group

```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)

SG_ID=$(aws ec2 create-security-group \
  --group-name ${PROJECT}-sg \
  --description "WhatsApp gateway" \
  --vpc-id $VPC_ID --query 'GroupId' --output text)

# Apenas HTTP/HTTPS. Porta 22 permanece FECHADA — acesso via SSM.
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 443 --cidr 0.0.0.0/0
```

> **Por que SSH fechado:** o Session Manager (SSM) dá shell na instância sem porta
> aberta, sem chave privada e com auditoria no CloudTrail. Porta 22 aberta na
> internet é alvo de varredura automatizada em minutos.

### 3.3 IAM Role da instância

```bash
cat > /tmp/trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
 "Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF

aws iam create-role --role-name ${PROJECT}-ec2-role \
  --assume-role-policy-document file:///tmp/trust.json

# SSM (shell sem SSH) + ECR (pull de imagens) + CloudWatch (logs)
for POLICY in AmazonSSMManagedInstanceCore \
              AmazonEC2ContainerRegistryReadOnly \
              CloudWatchAgentServerPolicy; do
  aws iam attach-role-policy --role-name ${PROJECT}-ec2-role \
    --policy-arn arn:aws:iam::aws:policy/$POLICY
done

aws iam create-instance-profile --instance-profile-name ${PROJECT}-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name ${PROJECT}-profile --role-name ${PROJECT}-ec2-role
```

Política inline adicional para S3 (backup) e Secrets Manager — ver §5.2 e §6.

### 3.4 Lançar a instância

```bash
AMI_ID=$(aws ssm get-parameter \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
  --query 'Parameter.Value' --output text)

INSTANCE_ID=$(aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t4g.medium \
  --iam-instance-profile Name=${PROJECT}-profile \
  --security-group-ids $SG_ID \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{
      "VolumeSize":50,"VolumeType":"gp3","Encrypted":true,
      "DeleteOnTermination":false}}]' \
  --metadata-options 'HttpTokens=required' \
  --user-data file://scripts/user-data.sh \
  --tag-specifications \
    "ResourceType=instance,Tags=[{Key=Name,Value=${PROJECT}},{Key=Project,Value=wpp}]" \
  --query 'Instances[0].InstanceId' --output text)
```

| Flag | Por quê |
|---|---|
| `arm64` / `t4g` | Graviton é ~20% mais barato. Baileys e Node rodam nativamente em ARM |
| `Encrypted: true` | EBS criptografado — protege as credenciais de sessão em repouso (doc 08 §4.2) |
| `DeleteOnTermination: false` | Terminar a instância por engano **não** apaga as sessões WhatsApp |
| `HttpTokens=required` | Força IMDSv2, bloqueando a classe de ataque SSRF→credenciais |

### 3.5 Elastic IP

```bash
ALLOC_ID=$(aws ec2 allocate-address --domain vpc --query 'AllocationId' --output text)
aws ec2 associate-address --instance-id $INSTANCE_ID --allocation-id $ALLOC_ID
```

> ⚠️ **Elastic IP é obrigatório, não opcional.** O IP público padrão da EC2 muda a
> cada stop/start. As contas WhatsApp passariam a conectar de IPs diferentes —
> exatamente o sinal de "conta acessada de vários lugares" que dispara verificação
> de segurança e banimento.

### 3.6 DNS

```bash
# Registro A para <seu-dominio> apontando para o Elastic IP
aws route53 change-resource-record-sets --hosted-zone-id $ZONE_ID \
  --change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{
    "Name":"<SEU_DOMINIO>","Type":"A","TTL":300,
    "ResourceRecords":[{"Value":"'$EIP'"}]}}]}'
```

---

## 4. Docker Compose (produção)

Idêntico ao doc anterior, com estas particularidades AWS:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: wpp
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    expose: ["5432"]              # ⚠️ NUNCA ports:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
    logging: &logging
      driver: awslogs
      options:
        awslogs-group: /wpp/containers
        awslogs-region: us-east-1

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
    volumes: [redisdata:/data]
    expose: ["6379"]              # ⚠️ NUNCA ports:
    logging: *logging

  api:
    image: ${ECR_REGISTRY}/${PROJECT}-api:${TAG}
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres: { condition: service_healthy }
    expose: ["3000"]
    logging: *logging

  worker:
    image: ${ECR_REGISTRY}/${PROJECT}-worker:${TAG}
    restart: unless-stopped
    env_file: .env
    # ⚠️ NUNCA escalar. Duas instâncias corrompem as sessões WhatsApp (ADR-002).
    deploy:
      replicas: 1
    volumes:
      - sessions:/data/sessions
    depends_on:
      postgres: { condition: service_healthy }
    logging: *logging

  panel:
    image: ${ECR_REGISTRY}/${PROJECT}-panel:${TAG}
    restart: unless-stopped
    env_file: .env
    expose: ["3001"]
    logging: *logging

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
    logging: *logging

volumes:
  pgdata:
  redisdata:
  sessions:        # 🔴 CRÍTICO — perder = reescanear todos os QRs
  caddydata:
```

Caddy obtém e renova o certificado TLS automaticamente para `<seu-dominio>` —
sem ACM, sem Load Balancer (que custaria ~US$18/mês sozinho).

---

## 5. Deploy: GitHub Actions + ECR + SSM

### 5.1 Fluxo

```
git push origin main
      │
      ▼
GitHub Actions
      │ autentica via OIDC (sem credencial estática)
      ├─► build das imagens (api, panel, worker) para arm64
      ├─► push para ECR
      └─► aws ssm send-command na EC2
                    │
                    ▼
            EC2 executa:
            • docker compose pull
            • migrations do Prisma
            • up -d --no-deps api panel
            • worker SÓ se a imagem mudou
```

### 5.2 OIDC — GitHub sem credencial estática

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

Role com trust policy restrita ao seu repositório:

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::<ACCOUNT>:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike":   { "token.actions.githubusercontent.com:sub": "repo:<seu-usuario>/wpp-gateway:*" }
  }
}
```

> **Por que OIDC e não access key:** uma chave de acesso no GitHub Secrets é uma
> credencial permanente que vaza junto se a conta do GitHub for comprometida. OIDC
> emite credencial temporária (1h) apenas para workflows daquele repositório
> específico. Não há segredo AWS armazenado no GitHub.

### 5.3 Workflow

```yaml
name: Deploy
on:
  push: { branches: [main] }

permissions:
  id-token: write      # necessário para OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/wpp-github-deploy
          aws-region: us-east-1

      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr

      - uses: docker/setup-buildx-action@v3

      - name: Build & push (arm64)
        run: |
          for SVC in api worker panel; do
            docker buildx build \
              --platform linux/arm64 \
              -f docker/Dockerfile.$SVC \
              -t ${{ steps.ecr.outputs.registry }}/wpp-$SVC:${{ github.sha }} \
              -t ${{ steps.ecr.outputs.registry }}/wpp-$SVC:latest \
              --push .
          done

      - name: Deploy via SSM
        run: |
          CMD_ID=$(aws ssm send-command \
            --instance-ids ${{ secrets.EC2_INSTANCE_ID }} \
            --document-name AWS-RunShellScript \
            --parameters 'commands=["cd /opt/wpp && TAG=${{ github.sha }} ./deploy.sh"]' \
            --query 'Command.CommandId' --output text)

          aws ssm wait command-executed \
            --command-id $CMD_ID --instance-id ${{ secrets.EC2_INSTANCE_ID }}
```

> ⚠️ **`--platform linux/arm64` é obrigatório.** O runner do GitHub é x86; sem essa
> flag a imagem gerada não roda na t4g (Graviton) e o container falha ao subir.

### 5.4 `deploy.sh` na EC2

```bash
#!/bin/bash
set -euo pipefail
cd /opt/wpp

aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin $ECR_REGISTRY

docker compose pull
docker compose run --rm api pnpm --filter @wpp/database migrate:deploy

# api e panel reiniciam livremente
docker compose up -d --no-deps api panel

# worker só reinicia se a imagem mudou — cada restart derruba as sessões
if [ "$(docker inspect -f '{{.Image}}' wpp-worker-1)" != "$(docker images -q wpp-worker:$TAG)" ]; then
  echo "⚠️  Reiniciando worker — sessões WhatsApp serão reconectadas"
  docker compose up -d --no-deps worker
fi

docker image prune -f
```

---

## 6. Backup

### 6.1 Bucket S3 com lifecycle

```bash
BUCKET=wpp-gateway-backups-$(aws sts get-caller-identity --query Account --output text)

aws s3api create-bucket --bucket $BUCKET --region us-east-1

# Versionamento: protege contra ransomware e sobrescrita acidental
aws s3api put-bucket-versioning --bucket $BUCKET \
  --versioning-configuration Status=Enabled

# Bloqueia qualquer acesso público
aws s3api put-public-access-block --bucket $BUCKET \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Criptografia em repouso
aws s3api put-bucket-encryption --bucket $BUCKET \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Lifecycle: 30d Standard → Glacier IR → expira em 365d
aws s3api put-bucket-lifecycle-configuration --bucket $BUCKET \
  --lifecycle-configuration '{"Rules":[{
    "ID":"wpp-retention","Status":"Enabled","Filter":{"Prefix":""},
    "Transitions":[{"Days":30,"StorageClass":"GLACIER_IR"}],
    "Expiration":{"Days":365},
    "NoncurrentVersionExpiration":{"NoncurrentDays":30}}]}'
```

### 6.2 Script de backup

`/opt/wpp/scripts/backup.sh` — executado por cron.

```bash
#!/bin/bash
set -euo pipefail

BUCKET=s3://wpp-gateway-backups-XXXX
DATE=$(date +%Y%m%d_%H%M)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 1. Dump lógico do Postgres
docker compose -f /opt/wpp/docker-compose.yml exec -T postgres \
  pg_dump -U postgres --clean --if-exists wpp | gzip > $TMP/db_$DATE.sql.gz

# 2. Sessões WhatsApp — o dado mais crítico do sistema
docker run --rm -v wpp_sessions:/data -v $TMP:/out alpine \
  tar czf /out/sessions_$DATE.tar.gz -C /data .

# 3. Upload (S3 criptografa em repouso; SSE-S3 já configurado no bucket)
aws s3 cp $TMP/db_$DATE.sql.gz       $BUCKET/db/       --storage-class STANDARD_IA
aws s3 cp $TMP/sessions_$DATE.tar.gz $BUCKET/sessions/ --storage-class STANDARD_IA

# 4. Métrica de sucesso para o CloudWatch (alarme se parar de chegar)
aws cloudwatch put-metric-data \
  --namespace WPP/Backup --metric-name BackupSuccess --value 1
```

### 6.3 Agenda

| Item | Frequência | Cron | Criticidade |
|---|---|---|---|
| **Sessões WhatsApp** | 6/6 h | `0 */6 * * *` | 🔴 Perder = reescanear todos os QRs |
| **Banco Postgres** | Diário 02:00 | `0 2 * * *` | 🔴 Perder = perder histórico |
| Snapshot AMI da instância | Semanal | AWS Backup | 🟡 Acelera recuperação de desastre |

```cron
0 2 * * *   /opt/wpp/scripts/backup.sh >> /var/log/wpp-backup.log 2>&1
0 */6 * * * /opt/wpp/scripts/backup-sessions.sh >> /var/log/wpp-backup.log 2>&1
```

### 6.4 Restauração — procedimento testado

```bash
# Banco
aws s3 cp $BUCKET/db/db_20260907_0200.sql.gz - \
  | gunzip | docker compose exec -T postgres psql -U postgres wpp

# Sessões (com o worker PARADO)
docker compose stop worker
aws s3 cp $BUCKET/sessions/sessions_20260907_0000.tar.gz - \
  | docker run --rm -i -v wpp_sessions:/data alpine tar xzf - -C /data
docker compose start worker
```

> **Backup nunca restaurado não é backup.** Teste **mensalmente** em uma EC2
> descartável e registre a data do último teste bem-sucedido. Um dump corrompido
> descoberto no dia do desastre é o mesmo que não ter backup.

---

## 7. Secrets

`ENCRYPTION_KEY`, senhas de banco e SMTP ficam no **AWS Secrets Manager**, não no `.env`
versionado.

> **SMTP** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`) é usado tanto
> pelo worker (fallback de alerta, doc 04 §6.2) quanto pelo painel (recuperação de
> senha e convite de usuário, doc 08 §3.1). Os quatro vão juntos ou nenhum —
> `loadEnv()` rejeita configuração parcial. Para o primeiro teste: Gmail
> (`smtp.gmail.com:587`, `SMTP_USER` = a conta, `SMTP_PASSWORD` = uma **App
> Password** de 16 caracteres — a conta Google precisa de 2FA ativo; a senha
> normal não funciona em SMTP). Produção séria → Amazon SES ou Resend (troca só os
> quatro valores). Sem SMTP, o "Esqueci a senha" e o convite ficam indisponíveis,
> mas o login e os scripts `admin-create.sh` / `admin-reset.sh` seguem funcionando.
> Cada tenant tem seu conjunto `SMTP_*` no SSM (`/wpp-gateway/<tenant>/`).

> **`TENANT_TIMEZONE`** (fuso IANA, doc 05 §5) também é por tenant no SSM —
> decide a hora local usada pela janela de silêncio anti-ban, pela virada do
> limite diário/horário de envio (contadores em `apps/worker/src/state/counters.ts`),
> pela cota diária de projeto na API pública e pelo "hoje" do dashboard. O
> servidor roda em UTC; sem essa variável (default `UTC`), todos esses pontos
> viram à meia-noite/hora UTC — errado para qualquer tenant fora de UTC+0.
> `nova` (Colômbia) → `America/Bogota`; `acme` (Brasil) → `America/Sao_Paulo`.

```bash
aws secretsmanager create-secret --name wpp/production \
  --secret-string '{
    "POSTGRES_PASSWORD":"...","REDIS_PASSWORD":"...",
    "ENCRYPTION_KEY":"...","SESSION_SECRET":"...","SMTP_PASSWORD":"..."
  }'
```

Na inicialização, a EC2 monta o `.env` a partir do secret:

```bash
aws secretsmanager get-secret-value --secret-id wpp/production \
  --query SecretString --output text \
  | jq -r 'to_entries|.[]|"\(.key)=\(.value)"' > /opt/wpp/.env
chmod 600 /opt/wpp/.env
```

> 🔴 **Guarde a `ENCRYPTION_KEY` também num gerenciador de senhas externo.** Se o
> Secrets Manager for apagado por engano, as sessões WhatsApp e os secrets de
> webhook tornam-se irrecuperáveis — nem o backup resolve.

Custo: US$0,40/mês por secret.

---

## 8. Monitoramento

### 8.1 CloudWatch Alarms

| Alarme | Métrica | Limiar | Ação |
|---|---|---|---|
| CPU alta | `CPUUtilization` | > 80% por 10 min | SNS → e-mail |
| Disco cheio | `disk_used_percent` (agent) | > 80% | SNS → e-mail |
| RAM alta | `mem_used_percent` (agent) | > 90% | SNS → e-mail |
| **Backup falhou** | `WPP/Backup BackupSuccess` | ausente por 26 h | SNS → e-mail |
| Instância parada | `StatusCheckFailed` | ≥ 1 | Recuperação automática |

```bash
# Recuperação automática da instância em falha de hardware
aws cloudwatch put-metric-alarm \
  --alarm-name wpp-auto-recover \
  --metric-name StatusCheckFailed_System --namespace AWS/EC2 \
  --statistic Maximum --period 60 --evaluation-periods 2 --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --dimensions Name=InstanceId,Value=$INSTANCE_ID \
  --alarm-actions arn:aws:automate:us-east-1:ec2:recover
```

### 8.2 Watchdog externo

> ⚠️ **Obrigatório.** CloudWatch não avisa de forma confiável quando a própria região
> ou a instância inteira cai. Use um monitor externo (UptimeRobot, Healthchecks.io)
> apontando para `https://<seu-dominio>/health`, com alerta no seu celular.

### 8.3 Logs

Containers enviam para CloudWatch Logs (`awslogs` driver). Retenção de 30 dias:

```bash
aws logs put-retention-policy --log-group-name /wpp/containers --retention-in-days 30
```

---

## 9. Custo mensal estimado (us-east-1)

| Item | Configuração | On-Demand | Com Compute SP (1 ano) |
|---|---|---|---|
| EC2 `t4g.medium` | 24/7 | US$ 24,53 | **US$ 15,45** |
| EBS gp3 50 GB | | US$ 4,00 | US$ 4,00 |
| Elastic IP | associado | US$ 0,00 | US$ 0,00 |
| S3 backups | ~20 GB c/ lifecycle | US$ 0,60 | US$ 0,60 |
| ECR | ~5 GB | US$ 0,50 | US$ 0,50 |
| Secrets Manager | 1 secret | US$ 0,40 | US$ 0,40 |
| CloudWatch | logs + alarmes | US$ 2,00 | US$ 2,00 |
| Transferência de dados | ~10 GB out | US$ 0,90 | US$ 0,90 |
| **Subtotal AWS** | | **US$ 32,93** | **US$ 23,85** |
| | | *≈ R$ 180* | *≈ R$ 130* |
| 5 chips pré-pagos | | R$ 100-150 | R$ 100-150 |
| **Total** | | **≈ R$ 280-330** | **≈ R$ 230-280** |

> Elastic IP é gratuito **enquanto associado a uma instância em execução**. Se a
> instância for parada, passa a custar US$3,60/mês.

Análise de Savings Plan: ver `11-custos-aws.md`.

---

## 10. Checklist de provisionamento

- [ ] Security Group criado, **porta 22 fechada**
- [ ] IAM Role com SSM, ECR, S3, Secrets Manager, CloudWatch
- [ ] EC2 t4g.medium (arm64) com EBS criptografado e `DeleteOnTermination=false`
- [ ] IMDSv2 obrigatório (`HttpTokens=required`)
- [ ] **Elastic IP alocado e associado**
- [ ] Route53 apontando `<seu-dominio>`
- [ ] Docker + Compose instalados via user-data
- [ ] Secrets Manager populado; `ENCRYPTION_KEY` copiada para cofre externo
- [ ] Repositórios ECR criados (api, worker, panel)
- [ ] OIDC provider + role de deploy do GitHub
- [ ] Bucket S3 com versionamento, criptografia, lifecycle e bloqueio público
- [ ] Cron de backup ativo
- [ ] **Restauração testada** em instância descartável
- [ ] CloudWatch alarms + SNS por e-mail
- [ ] Watchdog externo configurado
- [ ] Caddy com TLS válido
- [ ] Checklist de segurança do doc 08 §8

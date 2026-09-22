#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# EC2 user-data — bootstrap da instância wpp-gateway (Amazon Linux 2023, ARM64).
# Roda UMA vez no primeiro boot. Idempotente o suficiente para reexecução manual.
#
# NÃO coloca segredos aqui. O .env de produção é escrito depois, via SSM
# (Parameter Store / Secrets Manager) pelo script de deploy.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
exec > >(tee /var/log/user-data.log) 2>&1
echo "== user-data iniciado: $(date -u) =="

APP_DIR=/opt/wpp-gateway
REGION="us-east-1"

# ── pacotes base ────────────────────────────────────────────────────────────
# git NÃO é instalado de propósito — os arquivos de deploy chegam via SSM.
dnf update -y
dnf install -y docker awscli tar gzip cronie
systemctl enable --now crond

# ── Docker + Compose v2 ────────────────────────────────────────────────────
systemctl enable --now docker
usermod -aG docker ec2-user

mkdir -p /usr/local/lib/docker/cli-plugins
COMPOSE_VERSION="v2.32.4"
curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-aarch64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version

# ── SSM agent (SSH fica FECHADO — acesso só via Session Manager) ────────────
dnf install -y https://s3.${REGION}.amazonaws.com/amazon-ssm-${REGION}/latest/linux_arm64/amazon-ssm-agent.rpm || true
systemctl enable --now amazon-ssm-agent

# ── CloudWatch agent: mem + disco (EC2 não emite essas métricas nativamente) ─
dnf install -y amazon-cloudwatch-agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/cw.json <<'JSON'
{
  "agent": { "metrics_collection_interval": 60 },
  "metrics": {
    "namespace": "wpp-gateway",
    "append_dimensions": { "InstanceId": "${aws:InstanceId}" },
    "metrics_collected": {
      "mem":  { "measurement": ["mem_used_percent"] },
      "disk": { "measurement": ["used_percent"], "resources": ["/"],
                "ignore_file_system_types": ["tmpfs","devtmpfs","overlay"] }
    }
  }
}
JSON
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/cw.json || true

# ── diretórios da app ──────────────────────────────────────────────────────
# ${APP_DIR}/docker  scripts  → arquivos de deploy (via SSM)
# ${APP_DIR}/tenants/<t>/.env → .env de cada tenant (montado do SSM no deploy)
# ${APP_DIR}/caddy/Caddyfile  → gerado por deploy-caddy.sh
mkdir -p "${APP_DIR}"/{docker,scripts,tenants,caddy}
chown -R ec2-user:ec2-user "${APP_DIR}"

# ── swap 2G (t4g.medium tem 4G RAM; margem p/ build/picos do Baileys) ───────
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ── login no ECR (a role da instância precisa de ecr:GetAuthorizationToken) ─
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com" || true

echo "== user-data concluído: $(date -u) =="
echo "Próximo passo: rodar scripts/deploy.sh via SSM para escrever .env e subir o compose."

#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy de UM tenant na EC2 — chamado via SSM pelo GitHub Actions.
#
# Uso:  deploy.sh <TENANT> <IMAGE_TAG>
#   TENANT     slug do tenant (ver scripts/tenants) — namespace SSM, project name
#   IMAGE_TAG  tag da imagem no ECR (normalmente o SHA do commit)
#
# Isolamento: cada tenant roda como project `wpp-<TENANT>` (containers, rede e
# volumes com prefixo próprio). Zero compartilhamento entre tenants.
#
# Passos:
#   1. monta o .env do tenant de /wpp-gateway/<TENANT>/* (SSM Parameter Store)
#   2. docker login ECR + pull da imagem
#   3. migrations (serviço `migrate`)
#   4. sobe/recria: api+panel sempre; worker só se a imagem mudou (Baileys stateful)
#   5. cron de backup do tenant + prune
#
# NÃO mexe no Caddy — use scripts/deploy-caddy.sh para (re)gerar o proxy.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TENANT="${1:?uso: deploy.sh <TENANT> <IMAGE_TAG>}"
IMAGE_TAG="${2:?uso: deploy.sh <TENANT> <IMAGE_TAG>}"
REGION="us-east-1"
APP_DIR="/opt/wpp-gateway"
REPO="wpp-gateway"
SSM_PREFIX="/wpp-gateway/${TENANT}"
PROJECT="wpp-${TENANT}"
TENANT_DIR="${APP_DIR}/tenants/${TENANT}"
ENV_FILE="${TENANT_DIR}/.env"

case "${TENANT}" in
  [a-z0-9-]*) ;;
  *) echo "ERRO: TENANT inválido: '${TENANT}' (use [a-z0-9-])" >&2; exit 1 ;;
esac

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
export ECR_IMAGE="${ECR_REGISTRY}/${REPO}:${IMAGE_TAG}"
export TENANT
export TENANT_ENV_FILE="${ENV_FILE}"

echo "== [${TENANT}] [1/5] .env de ${SSM_PREFIX}/ =="
mkdir -p "${TENANT_DIR}"
umask 077
aws ssm get-parameters-by-path \
  --path "${SSM_PREFIX}/" --with-decryption --recursive --region "${REGION}" \
  --query "Parameters[].[Name,Value]" --output text \
  | while IFS=$'\t' read -r name value; do
      printf '%s=%s\n' "${name#${SSM_PREFIX}/}" "$value"
    done > "${ENV_FILE}.tmp"

if [ ! -s "${ENV_FILE}.tmp" ]; then
  echo "ERRO: nenhum parâmetro em ${SSM_PREFIX}/ — abortando." >&2
  exit 1
fi
mv "${ENV_FILE}.tmp" "${ENV_FILE}"
# POSTGRES_PASSWORD / REDIS_PASSWORD precisam existir no SHELL para a
# interpolação do compose.app.yml. NÃO fazer `. ${ENV_FILE}` — valores como
# PANEL_BRAND_NAME="Acme Energy Ltd" (com espaço) quebram o source.
# Extrai só o que o compose interpola:
export POSTGRES_PASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' "${ENV_FILE}")"
export REDIS_PASSWORD="$(sed -n 's/^REDIS_PASSWORD=//p' "${ENV_FILE}")"
[ -n "${POSTGRES_PASSWORD}" ] || { echo "ERRO: POSTGRES_PASSWORD ausente em ${ENV_FILE}" >&2; exit 1; }
[ -n "${REDIS_PASSWORD}" ]    || { echo "ERRO: REDIS_PASSWORD ausente em ${ENV_FILE}" >&2; exit 1; }
echo "   ${ENV_FILE}: $(wc -l < "${ENV_FILE}") variáveis"

echo "== [${TENANT}] [2/5] docker login ECR + pull =="
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

docker pull "${ECR_IMAGE}"
NEW_IMAGE_ID=$(docker inspect --format '{{.Id}}' "${ECR_IMAGE}")

COMPOSE="docker compose -p ${PROJECT} \
  --env-file ${ENV_FILE} \
  --project-directory ${APP_DIR}/docker \
  -f ${APP_DIR}/docker/compose.app.yml"

# Imagem que o worker DESTE tenant está rodando agora. Comparar com a tag
# recém-baixada não funciona: o deploy roda tenant a tenant e o primeiro já
# deixa a nova tag no disco, então a partir do 2º tenant "antes == depois"
# e o worker nunca era recriado (bug do badSession ficou preso na imagem velha).
RUNNING_WORKER_IMAGE_ID=$(docker inspect --format '{{.Image}}' \
  "$($COMPOSE ps -q worker 2>/dev/null)" 2>/dev/null || echo "none")

echo "== [${TENANT}] [3/5] migrations =="
$COMPOSE run --rm migrate

echo "== [${TENANT}] [4/5] subindo serviços =="
$COMPOSE up -d postgres redis
$COMPOSE up -d --force-recreate --no-deps api panel

if [ "${RUNNING_WORKER_IMAGE_ID}" != "${NEW_IMAGE_ID}" ] || [ -z "$($COMPOSE ps -q worker)" ]; then
  echo "   imagem mudou (ou worker parado) → recriando worker"
  $COMPOSE up -d --force-recreate --no-deps worker
else
  echo "   imagem inalterada → worker mantido (sessões preservadas)"
fi

echo "== [${TENANT}] [5/5] cron + prune =="
bash "${APP_DIR}/scripts/install-cron.sh" || echo "   (aviso: install-cron falhou)"

docker image prune -f >/dev/null 2>&1 || true
# mantém as 3 imagens mais recentes do repo
docker images "${ECR_REGISTRY}/${REPO}" --format '{{.Tag}} {{.ID}}' | tail -n +4 \
  | while read -r tag _; do
      [ "$tag" = "${IMAGE_TAG}" ] || [ "$tag" = "latest" ] && continue
      docker rmi "${ECR_REGISTRY}/${REPO}:${tag}" 2>/dev/null || true
    done

echo "== [${TENANT}] deploy OK: ${IMAGE_TAG} =="
$COMPOSE ps

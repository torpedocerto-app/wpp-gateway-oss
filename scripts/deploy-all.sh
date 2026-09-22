#!/bin/bash
# Deploy de TODOS os tenants de scripts/tenants + o Caddy. Chamado via SSM
# pelo GitHub Actions (a imagem é a mesma para todos; muda só o .env).
#
# Uso: deploy-all.sh <IMAGE_TAG>
set -euo pipefail

IMAGE_TAG="${1:?uso: deploy-all.sh <IMAGE_TAG>}"
APP_DIR="/opt/wpp-gateway"
TENANTS_FILE="${APP_DIR}/scripts/tenants"

mapfile -t ROWS < <(grep -vE '^\s*(#|$)' "${TENANTS_FILE}")
echo "== deploy-all: ${#ROWS[@]} tenant(s), tag ${IMAGE_TAG} =="

rc=0
for row in "${ROWS[@]}"; do
  name="${row%% *}"
  echo
  echo "############ TENANT: ${name} ############"
  # pula tenant que ainda não tem params no SSM (provisionamento incompleto)
  n=$(aws ssm get-parameters-by-path --path "/wpp-gateway/${name}/" --region us-east-1 \
        --query 'length(Parameters)' --output text 2>/dev/null || echo 0)
  if [ "${n}" = "0" ]; then
    echo ">>> /wpp-gateway/${name}/* vazio — tenant não provisionado, PULANDO"
    continue
  fi
  if ! bash "${APP_DIR}/scripts/deploy.sh" "${name}" "${IMAGE_TAG}"; then
    echo "!!! deploy do tenant ${name} FALHOU"
    rc=1
  fi
done

echo
echo "############ CADDY ############"
bash "${APP_DIR}/scripts/deploy-caddy.sh" || rc=1

exit "${rc}"

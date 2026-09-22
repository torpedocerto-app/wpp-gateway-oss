#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# ONE-SHOT — migra o stack legado (project `wpp-gateway`, compose
# docker-compose.prod.yml, Caddy embutido) para o layout multi-tenant:
#   project `wpp-ape` (compose.app.yml, SEM Caddy) + Caddy único (compose.caddy.yml)
#
# Preserva os dados: copia os volumes wpp-gateway_{pgdata,redisdata,sessions}
# para wpp-ape_{pgdata,redisdata,sessions}.
#
# Idempotente-ish: se wpp-ape_pgdata já existe e não está vazio, pula a cópia.
# Downtime: ~30–60s (o tempo de derrubar o legado e subir o novo).
#
# Uso (na EC2, como ec2-user):  bash migrate-to-multitenant.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/opt/wpp-gateway"
OLD_PROJECT="wpp-gateway"
NEW_TENANT="ape"
NEW_PROJECT="wpp-${NEW_TENANT}"

echo "== 0. checagens =="
command -v docker >/dev/null || { echo "sem docker" >&2; exit 1; }
[ -f "${APP_DIR}/tenants/${NEW_TENANT}/.env" ] || {
  echo "ERRO: ${APP_DIR}/tenants/${NEW_TENANT}/.env não existe." >&2
  echo "Rode antes: sudo -u ec2-user bash ${APP_DIR}/scripts/deploy.sh ${NEW_TENANT} <TAG>" >&2
  echo "(ele monta o .env do SSM /wpp-gateway/${NEW_TENANT}/* — mas NÃO suba os" >&2
  echo " serviços ainda; ou use este script que cuida da ordem)." >&2
  # não aborta: pode ser 1ª execução onde o .env vem do SSM aqui mesmo
}

copy_vol() {
  local src="$1" dst="$2"
  if docker volume inspect "$dst" >/dev/null 2>&1 \
     && [ -n "$(docker run --rm -v "$dst":/v alpine:3 sh -c 'ls -A /v' 2>/dev/null)" ]; then
    echo "   ${dst} já existe e não está vazio → pulo a cópia"
    return
  fi
  echo "   ${src} → ${dst}"
  docker volume create "$dst" >/dev/null
  docker run --rm -v "$src":/from:ro -v "$dst":/to alpine:3 \
    sh -c 'cd /from && cp -a . /to/'
}

OLD_PG="${OLD_PROJECT}-postgres-1"

echo "== 1. backup do banco antes de mexer =="
if docker ps -a --format '{{.Names}}' | grep -qx "${OLD_PG}"; then
  TS=$(date -u +%Y%m%d-%H%M%S)
  docker start "${OLD_PG}" >/dev/null 2>&1 || true
  sleep 3
  docker exec -i "${OLD_PG}" pg_dump -U wpp -d wpp --no-owner --clean --if-exists \
    | gzip -9 > "/tmp/pre-migration-${TS}.sql.gz"
  aws s3 cp "/tmp/pre-migration-${TS}.sql.gz" \
    "s3://wpp-gateway-backups-123456789012/${NEW_TENANT}/db/pre-migration-${TS}.sql.gz" \
    --region us-east-1 --only-show-errors || echo "   (aviso: upload do backup falhou)"
  echo "   backup: /tmp/pre-migration-${TS}.sql.gz ($(stat -c%s "/tmp/pre-migration-${TS}.sql.gz") bytes)"
else
  echo "   (sem container ${OLD_PG} — pulando backup)"
fi

echo "== 2. derruba os containers do stack legado (mantém volumes) =="
# não temos mais o compose legado; paramos/removemos por nome de container
for c in $(docker ps -a --format '{{.Names}}' | grep "^${OLD_PROJECT}-" || true); do
  echo "   rm ${c}"
  docker rm -f "${c}" >/dev/null
done
# rede legada
docker network rm "${OLD_PROJECT}_default" >/dev/null 2>&1 || true

echo "== 3. copia volumes para o namespace do tenant '${NEW_TENANT}' =="
copy_vol "${OLD_PROJECT}_pgdata"    "${NEW_PROJECT}_pgdata"
copy_vol "${OLD_PROJECT}_redisdata" "${NEW_PROJECT}_redisdata"
copy_vol "${OLD_PROJECT}_sessions"  "${NEW_PROJECT}_sessions"

echo "== 4. sobe o tenant '${NEW_TENANT}' no layout novo =="
IMAGE_TAG="$(cat "${APP_DIR}/.image-tag" 2>/dev/null || true)"
if [ -z "${IMAGE_TAG}" ]; then
  # descobre a tag pela imagem que já está na box
  IMAGE_TAG="$(docker images --format '{{.Repository}}:{{.Tag}}' \
    | grep 'wpp-gateway' | grep -v ':latest' | head -n1 | sed 's/.*://')"
fi
[ -n "${IMAGE_TAG}" ] || { echo "ERRO: não achei IMAGE_TAG" >&2; exit 1; }
echo "   usando tag: ${IMAGE_TAG}"
bash "${APP_DIR}/scripts/deploy.sh" "${NEW_TENANT}" "${IMAGE_TAG}"

echo "== 5. Caddy único =="
bash "${APP_DIR}/scripts/deploy-caddy.sh"

echo "== 6. limpeza dos volumes legados (só depois de validar!) =="
echo "   Quando confirmar que ${NEW_PROJECT} está OK, rode manualmente:"
echo "     docker volume rm ${OLD_PROJECT}_pgdata ${OLD_PROJECT}_redisdata ${OLD_PROJECT}_sessions ${OLD_PROJECT}_caddydata ${OLD_PROJECT}_caddyconfig"

echo "== migração concluída =="
docker compose -p "${NEW_PROJECT}" --env-file "${APP_DIR}/tenants/${NEW_TENANT}/.env" \
  --project-directory "${APP_DIR}/docker" -f "${APP_DIR}/docker/compose.app.yml" ps

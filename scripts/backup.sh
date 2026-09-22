#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Backup para S3, POR TENANT. Roda na EC2 via cron (ver scripts/install-cron.sh).
#
#   backup.sh <TENANT> db        → pg_dump   → s3://.../<TENANT>/db/
#   backup.sh <TENANT> sessions  → tar sessões → s3://.../<TENANT>/sessions/
#
# Retenção: lifecycle do bucket (db/ 90d, sessions/ 30d — prefixos casam
# ...<tenant>/db/ e ...<tenant>/sessions/).
# Em falha, alerta via SNS.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TENANT="${1:?uso: backup.sh <TENANT> <db|sessions>}"
KIND="${2:?uso: backup.sh <TENANT> <db|sessions>}"
BUCKET="s3://wpp-gateway-backups-123456789012"
REGION="us-east-1"
SNS_TOPIC="arn:aws:sns:us-east-1:123456789012:wpp-gateway-ops"
APP_DIR="/opt/wpp-gateway"
PROJECT="wpp-${TENANT}"
TS="$(date -u +%Y%m%d-%H%M%S)"
HOST="$(hostname -s)"

COMPOSE="docker compose -p ${PROJECT} \
  --env-file ${APP_DIR}/tenants/${TENANT}/.env \
  --project-directory ${APP_DIR}/docker \
  -f ${APP_DIR}/docker/compose.app.yml"

log()  { echo "[$(date -u +%FT%TZ)] [${TENANT}/${KIND}] $*"; }
fail() {
  log "ERRO: $*"
  aws sns publish --region "${REGION}" --topic-arn "${SNS_TOPIC}" \
    --subject "[wpp-gateway] backup ${TENANT}/${KIND} FALHOU (${HOST})" \
    --message "host ${HOST}, ${TS} UTC: $1" >/dev/null 2>&1 || true
  exit 1
}

case "${KIND}" in
  db)
    OUT="/tmp/wpp-${TENANT}-db-${TS}.sql.gz"
    log "pg_dump…"
    $COMPOSE exec -T postgres pg_dump -U wpp -d wpp --no-owner --clean --if-exists \
      | gzip -9 > "${OUT}" || fail "pg_dump"
    SIZE=$(stat -c%s "${OUT}")
    [ "${SIZE}" -gt 1000 ] || fail "dump muito pequeno (${SIZE} bytes)"
    aws s3 cp "${OUT}" "${BUCKET}/${TENANT}/db/db-${TS}.sql.gz" --region "${REGION}" \
      --only-show-errors || fail "upload s3"
    rm -f "${OUT}"
    log "OK → ${BUCKET}/${TENANT}/db/db-${TS}.sql.gz (${SIZE} bytes)"
    ;;

  sessions)
    VOL="${PROJECT}_sessions"
    OUT="/tmp/wpp-${TENANT}-sessions-${TS}.tar.gz"
    docker volume inspect "${VOL}" >/dev/null 2>&1 || fail "volume ${VOL} não encontrado"
    log "tar das sessões (via container, volume é root:0700)…"
    docker run --rm -v "${VOL}:/src:ro" alpine:3 \
      sh -c 'tar -czf - -C /src .' > "${OUT}" || fail "tar sessions"
    SIZE=$(stat -c%s "${OUT}")
    [ "${SIZE}" -gt 40 ] || fail "tar de sessões vazio (${SIZE} bytes)"
    aws s3 cp "${OUT}" "${BUCKET}/${TENANT}/sessions/sessions-${TS}.tar.gz" --region "${REGION}" \
      --only-show-errors || fail "upload s3"
    rm -f "${OUT}"
    log "OK → ${BUCKET}/${TENANT}/sessions/sessions-${TS}.tar.gz (${SIZE} bytes)"
    ;;

  *)
    fail "tipo inválido: ${KIND} (use db ou sessions)"
    ;;
esac

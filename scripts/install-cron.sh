#!/bin/bash
# Instala os cronjobs de backup na EC2 — um par (db + sessions) POR TENANT
# de scripts/tenants. Idempotente: reescreve só o bloco do wpp-gateway.
set -euo pipefail

APP_DIR="/opt/wpp-gateway"
TENANTS_FILE="${APP_DIR}/scripts/tenants"
MARKER="# wpp-gateway backups"

mapfile -t ROWS < <(grep -vE '^\s*(#|$)' "${TENANTS_FILE}")

# preserva linhas que não são nossas
EXISTING="$(crontab -l 2>/dev/null | grep -v "${MARKER}" | grep -v "${APP_DIR}/scripts/backup.sh" || true)"

{
  [ -n "${EXISTING}" ] && echo "${EXISTING}"
  echo "${MARKER}"
  i=0
  for row in "${ROWS[@]}"; do
    name="${row%% *}"
    # espalha os horários: db no minuto (10 + i*3), sessions no (35 + i*3)
    dbmin=$(( 10 + i * 3 ))
    semin=$(( 35 + i * 3 ))
    echo "${dbmin} 4 * * *  bash ${APP_DIR}/scripts/backup.sh ${name} db      >> /var/log/wpp-backup.log 2>&1"
    echo "${semin} */6 * * * bash ${APP_DIR}/scripts/backup.sh ${name} sessions >> /var/log/wpp-backup.log 2>&1"
    i=$(( i + 1 ))
  done
} | crontab -

echo "crontab instalado:"
crontab -l | grep -A"$(( ${#ROWS[@]} * 2 ))" "${MARKER}"
sudo touch /var/log/wpp-backup.log 2>/dev/null && sudo chown ec2-user:ec2-user /var/log/wpp-backup.log 2>/dev/null || true

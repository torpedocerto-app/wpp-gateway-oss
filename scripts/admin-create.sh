#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Cria um usuário do painel de UM tenant (tipicamente o PRIMEIRO). Independente
# de SMTP. Os usuários seguintes normalmente entram por convite na tela de
# Usuários do painel.
#
# Uso:  admin-create.sh <TENANT> <EMAIL>
#   TENANT   slug do tenant (ver scripts/tenants)
#   EMAIL    email do novo usuário
#
# Cria a linha em admin_users com password_hash='SETUP_PENDING', gera um token
# de setup (INVITE, 72h) e imprime a URL /login/setup?token=... para o usuário
# definir senha (≥12 chars) + 2FA.
#
# Roda na EC2 (via SSM ou SSH), dentro do container `panel` do tenant.
# Não derruba nenhum serviço.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TENANT="${1:?uso: admin-create.sh <TENANT> <EMAIL>}"
EMAIL="${2:?uso: admin-create.sh <TENANT> <EMAIL>}"
APP_DIR="/opt/wpp-gateway"
PROJECT="wpp-${TENANT}"
ENV_FILE="${APP_DIR}/tenants/${TENANT}/.env"

case "${TENANT}" in
  [a-z0-9-]*) ;;
  *) echo "ERRO: TENANT inválido: '${TENANT}' (use [a-z0-9-])" >&2; exit 1 ;;
esac
case "${EMAIL}" in
  *@*.*) ;;
  *) echo "ERRO: EMAIL inválido: '${EMAIL}'" >&2; exit 1 ;;
esac

[ -s "${ENV_FILE}" ] || { echo "ERRO: ${ENV_FILE} não existe — tenant sem deploy?" >&2; exit 1; }

COMPOSE="docker compose -p ${PROJECT} \
  --env-file ${ENV_FILE} \
  --project-directory ${APP_DIR}/docker \
  -f ${APP_DIR}/docker/compose.app.yml"

if [ -z "$(${COMPOSE} ps -q panel)" ]; then
  echo "ERRO: container panel do tenant '${TENANT}' não está no ar." >&2
  exit 1
fi

echo "== admin-create [${TENANT}] — ${EMAIL} =="

# Roda dentro do container, na pasta do painel (onde @wpp/database resolve),
# como ESM. Parâmetros por env para não interpolar string no JS.
${COMPOSE} exec -T -e NEW_EMAIL="${EMAIL}" -w /app/apps/panel panel \
  node --input-type=module -e '
import crypto from "node:crypto";
import { prisma } from "@wpp/database";
const email = process.env.NEW_EMAIL.trim().toLowerCase();
if (await prisma.adminUser.findUnique({ where: { email } })) {
  console.error("Já existe um usuário com esse email: " + email);
  process.exit(1);
}
const user = await prisma.adminUser.create({ data: { email, passwordHash: "SETUP_PENDING" } });
const raw = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(raw).digest("hex");
await prisma.adminToken.create({ data: {
  userId: user.id, purpose: "INVITE", tokenHash: hash,
  expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
}});
const base = process.env.PANEL_PUBLIC_URL || "https://<painel>";
console.log("OK — usuário " + email + " criado.\n");
console.log("Abra este link para definir a senha + 2FA (expira em 72h):");
console.log("   " + base + "/login/setup?token=" + raw);
await prisma.$disconnect();
'

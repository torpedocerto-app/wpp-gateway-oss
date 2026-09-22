#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Reset de um usuário do painel de UM tenant — recuperação de acesso.
# Independente de SMTP (é o break-glass quando o "Esqueci a senha" não serve).
#
# Uso:  admin-reset.sh <TENANT> [--email <ADDR>] [--password-only]
#   TENANT           slug do tenant (ver scripts/tenants)
#   --email <ADDR>   qual usuário resetar; sem isto, reseta o MAIS ANTIGO
#   --password-only  zera só a senha; mantém o TOTP (2FA) atual
#
# Sem --password-only: zera senha E TOTP. No próximo acesso ao painel o usuário
# passa por /login/setup (senha ≥12 chars + QR novo do 2FA).
#
# Efeito no banco (admin_users, 1 registro):
#   password_hash = 'SETUP_PENDING'
#   totp_secret   = NULL          (omitido com --password-only)
#   totp_enabled  = false         (omitido com --password-only)
#
# Além de zerar a senha, gera um token de setup (INVITE, 72h) e imprime a URL
# /login/setup?token=... — assim funciona mesmo com vários usuários e sem SMTP.
#
# Roda na EC2 (via SSM ou SSH). Executa dentro do container `panel` do tenant,
# que já tem @wpp/database + DATABASE_URL. Não derruba nenhum serviço.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TENANT="${1:?uso: admin-reset.sh <TENANT> [--email <ADDR>] [--password-only]}"
shift || true

TARGET_EMAIL=""
WIPE_TOTP=1
while [ $# -gt 0 ]; do
  case "$1" in
    --email) TARGET_EMAIL="${2:?--email exige um endereço}"; shift 2 ;;
    --password-only) WIPE_TOTP=0; shift ;;
    *) echo "ERRO: argumento inválido: '$1'" >&2; exit 1 ;;
  esac
done

APP_DIR="/opt/wpp-gateway"
PROJECT="wpp-${TENANT}"
ENV_FILE="${APP_DIR}/tenants/${TENANT}/.env"

case "${TENANT}" in
  [a-z0-9-]*) ;;
  *) echo "ERRO: TENANT inválido: '${TENANT}' (use [a-z0-9-])" >&2; exit 1 ;;
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

echo "== admin-reset [${TENANT}] — $([ "${WIPE_TOTP}" = 1 ] && echo 'senha + TOTP' || echo 'só senha')${TARGET_EMAIL:+ — ${TARGET_EMAIL}} =="

# Roda dentro do container, na pasta do painel (onde @wpp/database resolve),
# como ESM. Parâmetros por env para não interpolar string no JS.
${COMPOSE} exec -T -e WIPE_TOTP="${WIPE_TOTP}" -e TARGET_EMAIL="${TARGET_EMAIL}" -w /app/apps/panel panel \
  node --input-type=module -e '
import crypto from "node:crypto";
import { prisma } from "@wpp/database";
const email = process.env.TARGET_EMAIL;
const admin = email
  ? await prisma.adminUser.findUnique({ where: { email } })
  : await prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } });
if (!admin) {
  console.error(email ? "Usuário não encontrado: " + email : "Nenhum admin em admin_users.");
  process.exit(1);
}
const data = { passwordHash: "SETUP_PENDING", disabledAt: null };
if (process.env.WIPE_TOTP === "1") { data.totpSecret = null; data.totpEnabled = false; }
await prisma.adminUser.update({ where: { id: admin.id }, data });

await prisma.adminToken.deleteMany({ where: { userId: admin.id, usedAt: null } });
const raw = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(raw).digest("hex");
await prisma.adminToken.create({ data: {
  userId: admin.id, purpose: "INVITE", tokenHash: hash,
  expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
}});

const base = process.env.PANEL_PUBLIC_URL || "https://<painel>";
console.log("OK — usuário " + admin.email + " resetado (e reativado, se estava desativado).");
console.log("   password_hash = SETUP_PENDING");
if (process.env.WIPE_TOTP === "1") console.log("   totp_secret = NULL, totp_enabled = false");
console.log("\nAbra este link para definir a senha nova + 2FA (expira em 72h):");
console.log("   " + base + "/login/setup?token=" + raw);
await prisma.$disconnect();
'

echo
echo "⚠️  Anote a senha nova — depois disso, use 'Esqueci a senha' no painel (se o SMTP estiver configurado)."

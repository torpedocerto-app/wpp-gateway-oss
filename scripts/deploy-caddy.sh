#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# (Re)gera o Caddyfile e o compose.caddy.yml a partir de scripts/tenants e
# (re)sobe o Caddy único da EC2.
#
# Uso: deploy-caddy.sh
#
# Para cada tenant "<nome> <dominio>":
#   - bloco de site no Caddyfile: TLS automático, /v1/* → api-<nome>, resto → panel
#   - rede wpp-<nome>_net adicionada ao compose.caddy.yml (external)
#
# Os hostnames api/panel são resolvidos pelo DNS interno do Docker DENTRO da
# rede de cada tenant: o serviço `api` do projeto wpp-<nome> atende em
# `api` na rede wpp-<nome>_net. Como o Caddy está em várias redes, referenciamos
# pelo alias de rede completo: <servico>.<rede> não funciona; usamos o nome do
# container previsível: wpp-<nome>-api-1 / wpp-<nome>-panel-1.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/opt/wpp-gateway"
TENANTS_FILE="${APP_DIR}/scripts/tenants"
CADDY_DIR="${APP_DIR}/caddy"
CADDYFILE="${CADDY_DIR}/Caddyfile"
COMPOSE_CADDY="${APP_DIR}/docker/compose.caddy.yml"

[ -f "${TENANTS_FILE}" ] || { echo "ERRO: ${TENANTS_FILE} não existe" >&2; exit 1; }
mkdir -p "${CADDY_DIR}"

# tenants ativos: normaliza para "<nome> <dominio>" (colapsa espaços múltiplos)
mapfile -t ROWS < <(grep -vE '^\s*(#|$)' "${TENANTS_FILE}" | awk '{print $1, $2}')
[ "${#ROWS[@]}" -gt 0 ] || { echo "ERRO: nenhum tenant em ${TENANTS_FILE}" >&2; exit 1; }

ACME_EMAIL="${ACME_EMAIL:-ops@example.com}"

echo "== gerando Caddyfile para ${#ROWS[@]} tenant(s) =="
{
  echo "# GERADO por scripts/deploy-caddy.sh — NÃO editar à mão."
  echo "# Fonte: scripts/tenants"
  echo
  echo "{"
  echo "    email ${ACME_EMAIL}"
  echo "}"
  echo
  for row in "${ROWS[@]}"; do
    name="${row%% *}"; domain="${row##* }"
    # só emite bloco de site para tenant com stack no ar (evita Caddy tentar
    # cert p/ domínio que ainda dá 502 e bater rate limit do Let's Encrypt)
    if ! docker network inspect "wpp-${name}_net" >/dev/null 2>&1; then
      echo "# (tenant '${name}' / ${domain} ainda não implantado — bloco omitido)"
      echo
      continue
    fi
    cat <<EOF
${domain} {
    encode gzip
    handle /v1/* {
        reverse_proxy wpp-${name}-api-1:3000
    }
    handle {
        reverse_proxy wpp-${name}-panel-1:3001 {
            flush_interval -1
        }
    }
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }
    log {
        output stdout
        format console
    }
}

EOF
  done
} > "${CADDYFILE}"

echo "== gerando ${COMPOSE_CADDY} =="
# Só liga o Caddy às redes de tenants cujo stack JÁ existe (a rede
# wpp-<name>_net é criada pelo compose.app.yml no deploy do tenant).
# Um tenant listado mas ainda não implantado tem bloco no Caddyfile (dará 502
# até subir) mas não entra aqui — senão `compose up` falha com rede inexistente.
ACTIVE_NETS=()
for row in "${ROWS[@]}"; do
  name="${row%% *}"
  if docker network inspect "wpp-${name}_net" >/dev/null 2>&1; then
    ACTIVE_NETS+=("wpp-${name}_net")
  else
    echo "   (tenant '${name}' ainda sem rede — Caddy não conecta ainda)"
  fi
done
[ "${#ACTIVE_NETS[@]}" -gt 0 ] || { echo "ERRO: nenhum tenant ativo p/ o Caddy" >&2; exit 1; }

{
  echo "# GERADO por scripts/deploy-caddy.sh — NÃO editar à mão."
  echo "services:"
  echo "  caddy:"
  echo "    image: caddy:2-alpine"
  echo "    container_name: wpp-caddy"
  echo "    restart: unless-stopped"
  echo "    ports:"
  echo '      - "80:80"'
  echo '      - "443:443"'
  echo "    volumes:"
  echo "      - /opt/wpp-gateway/caddy/Caddyfile:/etc/caddy/Caddyfile:ro"
  echo "      - caddydata:/data"
  echo "      - caddyconfig:/config"
  echo "    logging:"
  echo "      driver: json-file"
  echo '      options: { max-size: "20m", max-file: "5" }'
  echo "    networks:"
  for n in "${ACTIVE_NETS[@]}"; do echo "      - ${n}"; done
  echo "networks:"
  for n in "${ACTIVE_NETS[@]}"; do
    echo "  ${n}:"
    echo "    external: true"
  done
  echo "volumes:"
  echo "  caddydata:"
  echo "  caddyconfig:"
} > "${COMPOSE_CADDY}"

echo "== (re)subindo o Caddy =="
# valida a config antes
docker run --rm -v "${CADDYFILE}:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

docker compose -p wpp-caddy -f "${COMPOSE_CADDY}" up -d
sleep 2
docker compose -p wpp-caddy -f "${COMPOSE_CADDY}" exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null || true

echo "== Caddy OK =="
docker compose -p wpp-caddy -f "${COMPOSE_CADDY}" ps

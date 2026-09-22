# Imagem única do monorepo. Cada serviço (api, worker, panel) roda a mesma
# imagem com um CMD diferente no compose. Target: linux/arm64 (EC2 Graviton).
#
# Trade-off consciente: imagem maior que multi-stage por serviço, mas MUITO
# menos superfície de erro no primeiro deploy. Otimizar depois se necessário.
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# CI=true: pnpm não tenta purgar node_modules interativamente (sem TTY no build)
ENV CI=true
RUN corepack enable && corepack prepare pnpm@11.10.0 --activate
# toolchain para addons nativos: argon2, libsignal (fork do Baileys), better-sqlite? não.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates dumb-init curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── deps (cache por manifesto) ────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages/config/package.json    packages/config/
COPY packages/shared/package.json    packages/shared/
COPY packages/database/package.json  packages/database/
COPY packages/queue/package.json     packages/queue/
COPY packages/email/package.json     packages/email/
COPY apps/api/package.json           apps/api/
COPY apps/worker/package.json        apps/worker/
COPY apps/panel/package.json         apps/panel/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── build tudo ──────────────────────────────────────────────────────────
FROM deps AS build
# copia o código (node_modules fica de fora pelo .dockerignore) sobre a
# camada `deps`, que já tem node_modules instalado para linux/arm64.
COPY . .
# reinstala só o que faltar (lockfile já satisfeito → rápido) e roda os
# postinstall/prepare de workspace que dependem do código-fonte presente.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline
RUN pnpm --filter @wpp/database exec prisma generate
# pacotes + api + worker (tsc). O painel Next builda em seguida.
RUN pnpm exec turbo run build --filter=@wpp/config --filter=@wpp/shared \
      --filter=@wpp/database --filter=@wpp/queue --filter=@wpp/email --filter=@wpp/api --filter=@wpp/worker
RUN pnpm --filter @wpp/panel exec next build

# ── runner ──────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
# copia o workspace já buildado (inclui node_modules com Prisma client gerado)
COPY --from=build /app /app

# healthcheck genérico — cada serviço sobrescreve a porta no compose
EXPOSE 3000 3001 3002
ENTRYPOINT ["dumb-init", "--"]
# CMD é definido por serviço no docker-compose.prod.yml
CMD ["node", "apps/api/dist/main.js"]

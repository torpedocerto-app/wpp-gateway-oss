# 01 — Arquitetura

---

## 1. Princípio estruturante

O sistema é dividido em **três processos independentes** que compartilham banco e Redis:

1. **API** — recebe requisições HTTP, valida, enfileira. Nunca fala com o WhatsApp.
2. **Worker de sessões** — mantém as conexões WebSocket vivas e envia/recebe mensagens.
3. **Painel** — interface web administrativa.

**Por que separar API e Worker:** as sessões do Baileys são *stateful* e persistentes
(WebSockets abertos 24/7). Se elas vivessem dentro do processo da API, qualquer deploy
ou crash da API derrubaria todas as conexões WhatsApp, exigindo reconexão — e reconexões
frequentes são um sinal de risco para banimento. Separando, você pode fazer deploy da
API dezenas de vezes por dia sem tocar nas sessões.

> ⚠️ **Restrição crítica:** o Worker de sessões roda como **instância única** (não
> escalável horizontalmente). Duas instâncias tentando manter a mesma sessão WhatsApp
> causam conflito de credenciais e derrubam a conta. Escala horizontal só é possível
> com sharding explícito de contas por instância — fora do escopo do MVP.

---

## 2. Diagrama de componentes

```
                          Internet
                              │
                    ┌─────────▼─────────┐
                    │   Nginx / Caddy   │  TLS, rate-limit de borda
                    └─────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼                               ▼
    ┌───────────────────┐          ┌───────────────────┐
    │   API (Fastify)   │          │  Painel (Next.js) │
    │   :3000           │          │  :3001            │
    │                   │          │                   │
    │ • POST /messages  │          │ • Login + 2FA     │
    │ • GET  /messages  │          │ • Contas / QR     │
    │ • GET  /accounts  │          │ • Dashboard       │
    │ • Auth por token  │          │ • Tokens          │
    └─────────┬─────────┘          └─────────┬─────────┘
              │                              │
              │      ┌───────────────────────┘
              ▼      ▼
    ┌─────────────────────────┐         ┌──────────────────────┐
    │      PostgreSQL         │◄────────┤   Worker de Sessões  │
    │                         │         │   (instância única)  │
    │ • accounts              │         │                      │
    │ • messages              │         │  ┌────────────────┐  │
    │ • api_tokens            │         │  │ Sessão conta 1 │  │
    │ • projects              │         │  ├────────────────┤  │
    │ • events / stats        │         │  │ Sessão conta 2 │  │
    └─────────────────────────┘         │  ├────────────────┤  │
                                        │  │ Sessão conta N │  │
    ┌─────────────────────────┐         │  └────────────────┘  │
    │      Redis              │◄────────┤                      │
    │                         │         │ • Consome fila       │
    │ • Fila BullMQ (outbound)│         │ • Health check 60s   │
    │ • Fila BullMQ (webhook) │         │ • Detecta ban        │
    │ • Rate-limit counters   │         │ • Emite webhook      │
    │ • Lock de conta         │         └──────────┬───────────┘
    └─────────────────────────┘                    │
                                                   ▼
                                          WhatsApp Web (WSS)
                                          via Baileys
```

---

## 3. Stack detalhada

### Runtime e linguagem
| Item | Escolha | Versão | Nota |
|---|---|---|---|
| Runtime | Node.js | 22 LTS | LTS até 2027 |
| Linguagem | TypeScript | 5.x | `strict: true` obrigatório |
| Gerenciador | pnpm | 9.x | Workspaces para o monorepo |

### Backend
| Item | Escolha | Por quê |
|---|---|---|
| Framework API | **Fastify** | Mais leve e rápido que Express, schema validation nativa via JSON Schema |
| WhatsApp | **@whiskeysockets/baileys** | Único maduro sem browser. **Fixar versão exata** — sem `^` |
| Fila | **BullMQ** | Padrão de mercado sobre Redis: retry, backoff, delayed jobs, prioridade |
| ORM | **Prisma** | Migrations versionadas, tipagem gerada automaticamente |
| Validação | **Zod** | Schemas compartilhados entre API e worker via pacote `shared` |
| Logs | **Pino** | JSON estruturado, nativo do Fastify, alta performance |

### Frontend (painel)
| Item | Escolha | Por quê |
|---|---|---|
| Framework | **Next.js 15** (App Router) | SSR, rotas de API para BFF, ecossistema maduro |
| UI | **shadcn/ui + Tailwind** | Componentes acessíveis, sem lock-in de biblioteca |
| Gráficos | **Recharts** | Suficiente para o dashboard, integra bem com shadcn |
| Realtime (QR) | **SSE** | Server-Sent Events bastam — fluxo é unidirecional. Mais simples que WebSocket |

### Dados
| Item | Escolha | Por quê |
|---|---|---|
| Banco | **PostgreSQL 16** | JSONB para payloads, particionamento para a tabela de mensagens |
| Cache/Fila | **Redis 7** | Backend do BullMQ, contadores de rate-limit, locks distribuídos |
| Sessões WhatsApp | **Filesystem + volume Docker** | Baileys grava credenciais em arquivos. Criptografados em repouso |

---

## 4. Estrutura do monorepo

```
wpp-gateway/
├── docs/                          # Esta documentação
├── apps/
│   ├── api/                       # Fastify — API pública
│   │   ├── src/
│   │   │   ├── routes/            # Handlers HTTP
│   │   │   ├── middleware/        # Auth por token, rate-limit
│   │   │   └── server.ts
│   │   └── package.json
│   ├── worker/                    # Sessões WhatsApp + consumo de fila
│   │   ├── src/
│   │   │   ├── sessions/          # SessionManager, ciclo de vida Baileys
│   │   │   ├── queue/             # Processadores BullMQ
│   │   │   ├── selector/          # Algoritmo de sorteio de conta
│   │   │   ├── errors/            # Taxonomia e classificação de erros
│   │   │   └── main.ts
│   │   └── package.json
│   └── panel/                     # Next.js — painel admin
│       └── package.json
├── packages/
│   ├── database/                  # Prisma schema + client + migrations
│   ├── shared/                    # Tipos, schemas Zod, constantes
│   └── config/                    # Env vars validadas com Zod
├── docker/
│   ├── docker-compose.yml
│   └── Dockerfile.*
├── pnpm-workspace.yaml
└── turbo.json                     # Orquestração de build/dev
```

**Por que monorepo:** os tipos do contrato da API, a taxonomia de erros e os schemas
Zod são compartilhados entre API, worker e painel. Em repositórios separados esses
contratos divergem silenciosamente.

---

## 5. Fluxo principal — envio de mensagem

```
 1. Projeto → POST /v1/messages
              Authorization: Bearer mk_live_xxx
              { "to": "5511999999999", "text": "Olá!" }
                              │
 2. API valida token ─────────┤ token inválido/revogado → 401
                              │
 3. API valida payload ───────┤ telefone malformado    → 422
                              │
 4. API checa rate-limit ─────┤ excedido               → 429
                              │
 5. API grava message (status=QUEUED) no Postgres
                              │
 6. API enfileira job no BullMQ (com delay anti-ban calculado)
                              │
 7. API responde 202 { messageId, status: "queued" }
                              ▼
    ────────────────── assíncrono ──────────────────
                              │
 8. Worker consome o job
                              │
 9. Selector sorteia conta saudável ──┤ nenhuma disponível → reagenda
                              │
10. Worker aplica delay humanizado (jitter)
                              │
11. Worker envia via Baileys ─────────┤ erro → classifica (doc 05)
                              │                    │
12. Sucesso: status=SENT              │       ┌────┴────┐
    Grava accountId usado             │       ▼         ▼
                              │   PERMANENTE  TRANSITÓRIO
13. Webhook de status ao projeto  status=FAILED  → fallback
                                  sem retry      outra conta
```

---

## 6. Fluxo de recebimento (inbound)

```
1. Baileys emite evento messages.upsert no Worker
2. Worker filtra: ignora mensagens próprias, status updates e grupos
3. Worker normaliza o telefone e grava message (direction=INBOUND)
4. Worker tenta correlacionar com a última mensagem OUTBOUND
   enviada para aquele contato (janela de 72h) → identifica o projeto
5. Se o projeto tem webhook configurado → enfileira job de webhook
6. Fila de webhook: POST com assinatura HMAC, retry com backoff
```

**Regra de correlação:** o inbound é atribuído ao projeto cuja última mensagem
outbound para aquele número foi a mais recente dentro de 72h. Sem correspondência,
a mensagem é gravada como `project_id = null` e aparece no painel como
"resposta não atribuída" — visível para o admin, sem webhook disparado.

---

## 7. Decisões de arquitetura registradas (ADR resumido)

**ADR-001 — Baileys em vez de whatsapp-web.js**
Contexto: ambas são não-oficiais. Decisão: Baileys, por não precisar de Chromium
(~50 MB vs ~400 MB de RAM por sessão). Consequência: menos recursos de UI disponíveis,
mas o MVP só precisa de texto.

**ADR-002 — Worker como instância única**
Contexto: sessões WhatsApp são stateful e não podem ser duplicadas. Decisão: uma
instância, com restart automático. Consequência: ponto único de falha para envio —
mitigado por healthcheck e restart do Docker. Escala futura exige sharding por conta.
**Esta é também a razão de EC2 em vez de Fargate (ADR-005).**

**ADR-003 — Fila obrigatória, sem modo síncrono**
Contexto: envio síncrono impediria delays anti-ban. Decisão: 100% assíncrono.
Consequência: projetos consumidores precisam lidar com webhook ou polling — custo
aceitável dado o ganho anti-ban.

**ADR-004 — SSE em vez de WebSocket para o QR**
Contexto: o QR code precisa chegar ao painel em tempo real e expira a cada ~20s.
Decisão: SSE, pois o fluxo é unidirecional (servidor → painel). Consequência:
infraestrutura mais simples, sem servidor WebSocket adicional.

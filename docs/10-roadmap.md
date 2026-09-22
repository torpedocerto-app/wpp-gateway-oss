# 10 — Roadmap de Implementação

Ordem de construção pensada para que **cada fase entregue algo verificável**.
As estimativas assumem desenvolvimento com assistência de IA e são de esforço,
não de calendário.

---

## Fase 0 — Fundação (~1 dia) ✅ CONCLUÍDA (2026-09-07)

**Objetivo:** esqueleto que sobe e conecta em tudo.

- [x] Monorepo pnpm + Turborepo, TypeScript `strict`
- [x] `packages/config` — env vars validadas com Zod (`loadEnv`)
- [x] `packages/database` — Prisma com o schema completo do doc 02
- [x] `packages/shared` — enums, schemas Zod, taxonomia de erros (envio + API)
- [x] Docker Compose local (Postgres 16 + Redis 7, `docker/docker-compose.dev.yml`)
- [x] Migration inicial + particionamento de `messages` (SQL manual: `PARTITION BY
      RANGE`, função `create_messages_partition`, índice único parcial de idempotência
      por partição, índice parcial de fila)
- [x] ESLint (flat config, type-checked), Prettier, Vitest — 12 testes de fumaça

✅ **Critério atingido:** `pnpm infra:up` sobe Postgres+Redis; `prisma migrate deploy`
cria as 9 tabelas + `messages` particionada (4 partições ago–nov); seed cria admin +
projeto + token. Fresh teardown/up/deploy validado do zero.

**Comandos úteis:**
- `pnpm infra:up` / `pnpm infra:down` — sobe/derruba Postgres e Redis
- `pnpm db:deploy` — aplica migrations · `pnpm db:seed` — popula dev
- `pnpm db:migrate` — cria nova migration · `pnpm db:studio` — Prisma Studio
- `pnpm exec vitest run` — testes · `pnpm exec eslint .` — lint · `pnpm exec turbo run build` — build

> ⚠️ **Nota sobre `message_attempts`:** não tem FK relacional para `messages` porque
> a tabela particionada tem PK composta `(id, created_at)`. A ligação é por
> `message_id` e a integridade é responsabilidade do worker (Fase 2).

---

## Fase 1 — Sessões WhatsApp (~2-3 dias) 🔴 *Maior risco técnico*

## Fase 1 — Sessões WhatsApp ✅ CONCLUÍDA (2026-09-07)

**Objetivo:** conectar uma conta real e enviar uma mensagem manual.

- [x] `SessionManager` — ciclo de vida do socket Baileys (`apps/worker/src/sessions/`)
- [x] `useMultiFileAuthState` com persistência em `data/sessions/{accountId}/` (permissão 0700)
- [x] Geração de QR — no terminal via `qrcode-terminal` (SSE fica para a Fase 6 com o painel)
- [x] Máquina de estados de `accounts` (doc 04 §1) — DISCONNECTED → QR_PENDING → CONNECTED → RECONNECTING → BANNED
- [x] Classificação de `DisconnectReason` (doc 04 §3) — `packages/shared/src/disconnect.ts`, 16 testes
- [x] Reconexão com backoff exponencial (5s→15s→45s→2m→5m, teto 15m, máx 10 tentativas)
- [x] Health check a cada 60 s (`SessionManager.runHealthCheck`)
- [x] Registro em `account_events` — todas as transições auditadas
- [x] CLI: `pnpm worker pair|send|list|logout`

✅ **Critério atingido (teste real, número +57…):**
- QR renderizado no terminal, escaneado, `CONNECTED` gravado com phone_number
- `pnpm worker send` entregou mensagem com **`ack: delivery_ack`** confirmado
- Rede derrubada → `RECONNECT_ATTEMPT` (1/2/3 com backoff correto) → reconectou sem novo QR

**Baileys:** `baileys@6.7.24` (linha estável `legacy`; 7.x é RC). Versão pinada exata.
Requer `blockExoticSubdeps: false` no workspace — o Baileys puxa um fork de libsignal
do GitHub, que é a forma canônica de instalar a lib.

**Aprendizados que viraram código:**
- `sendMessage` retornar sem erro ≠ mensagem entregue. `Session.waitForAck()` escuta
  `messages.update` e só confirma com status ≥ DELIVERY_ACK (3).
- O WebSocket abre segundos antes da sessão estar pronta para enviar.
  `Session.waitUntilReady()` resolve no evento `connection:'open'`, não no `isOpen`.
- `state.creds.registered` é `false` logo após carregar credenciais válidas;
  usar `state.creds.me?.id` para detectar sessão já pareada.

> **Por que primeiro:** era a única parte com incerteza real. Baileys funcionou como
> esperado; os ajustes foram de timing (ready/ack), não de viabilidade.

---

## Fase 2 — Fila e envio ✅ CONCLUÍDA (2026-09-07)

- [x] BullMQ (`bullmq` + `ioredis`) — fila `outbound` com prioridades 1/5/10 (doc 05 §1.1)
- [x] Sorteio ponderado (`packages/shared/src/selector.ts`) — capacidade × saúde × descanso × warmup, 17 testes
- [x] Lock por conta em Redis (`SET account:{id}:lock <token> NX EX 30`, release com Lua compare-and-del)
- [x] Contadores hora/dia em Redis com TTL (`acct:{id}:sent:hour|day`)
- [x] Delays humanizados + `composing` (`packages/shared/src/humanize.ts`) — base 8-25s ±30%, pausa longa 5%, janela de silêncio 23-6h, 12 testes
- [x] Verificação `onWhatsApp()` com cache Redis 7 dias (`wa:exists:{phone}`)
- [x] Taxonomia completa: `classifySendError` (erro bruto → SendErrorCode) + `decideAfterAttempt` (SendErrorCode → ação), 19 testes
- [x] Fallback máx 3 tentativas, contas distintas, delays 10s/30s entre elas
- [x] Registro em `message_attempts` por tentativa

✅ **Critério atingido (E2E real):** `pnpm worker enqueue` → job na fila → worker
sorteou conta, adquiriu lock, aplicou delay de 18s, emitiu `composing`, enviou.
Mensagem `DELIVERED` no banco, `message_attempts` com SUCCESS/2400ms, contadores
Redis em 1, cooldown ativo, `wa:exists` cacheado como `yes`.

**Testes de fallback com múltiplas contas reais:** adiados para a Fase 7 (exige chips
extras; cada teste "queima" reputação). A lógica está 100% coberta por testes unitários
(`fallback-decision.test.ts`, `selector.test.ts`).

**Arquitetura da concorrência:** 1 BullMQ Worker, concorrência = pool + 2. O lock
Redis por conta é o que garante "1 envio por conta por vez"; a concorrência só permite
contas DIFERENTES enviarem em paralelo.

**Ruído conhecido do Baileys:** `failed to decrypt message` / `No session record` com
`fromMe: true` aparece quando o WhatsApp reenvia notificação antiga de mensagem própria
cujo device signal saiu do store. É logado como ERROR mas não afeta envio nem inbound.

**Comandos:** `pnpm worker:dev` (worker longo) · `pnpm worker enqueue <num> <texto>` ·
`pnpm worker queue:status`

---

## Fase 3 — API pública ✅ CONCLUÍDA (2026-09-07)

- [x] Fastify 5 (`apps/api`) — validação Zod dos schemas de `@wpp/shared`
- [x] Middleware de auth por token (`auth.ts`) — SHA-256, cache Redis 60s, invalidação na revogação
- [x] `POST /v1/messages` com idempotência (índice único `project_id + external_id`)
- [x] `POST /v1/messages/bulk` (até 500, validação parcial)
- [x] `GET /v1/messages/{id}` (404 não 403 para msg de outro projeto) e listagem com cursor base64
- [x] `POST /v1/messages/{id}/cancel` (só QUEUED)
- [x] `GET /v1/health` (sem auth, sem expor telefones)
- [x] Rate limiting por token — implementação **manual** (`rate-limit.ts`), ver nota
- [x] Normalização E.164 (`phone.ts`) — internacional-first, fallback BR; suporta números CO sem `+`
- [x] Erros padronizados via `ApiError` + `setErrorHandler`
- [ ] OpenAPI gerado automaticamente — adiado para a Fase 6 (junto com o painel)

✅ **Critério atingido:**
- 14 testes de contrato via `app.inject()` (auth, validação, idempotência, cota, rate limit, cancel, health)
- E2E real: `POST /v1/messages` → fila → worker → **entrega confirmada** em número colombiano (+573001234567)

**Pacote novo `@wpp/queue`:** extraído do worker. Contém `queues.ts` (fila BullMQ +
`OutboundJobData`), `enqueue.ts` (`createAndEnqueue`) e `connection.ts`. API e worker
importam de lá; o worker mantém só os processadores (que dependem de Baileys).

**Rate limit manual (não `@fastify/rate-limit`):** o plugin resolve `max` no ciclo
`onRequest`, antes do nosso preHandler de auth — então nunca enxergava o
`rate_limit_per_minute` do projeto. `rate-limit.ts` roda como 2º preHandler (após
auth), com `INCR`+`EXPIRE` por janela de 60s. Headers `X-RateLimit-*` + `Retry-After`.

**🔴 Incidente e blindagem (ver memória `testes-nao-disparam-envio-real`):** durante o
debug do rate limit, rodar a suite em loop com um `pnpm worker:dev` aberto fez o
worker consumir os jobs dos testes e disparar ~12 mensagens reais. Corrigido com 3
camadas: fila `outbound-test` sob `NODE_ENV=test`, guard que impede o worker de subir
em test, e mock de `createAndEnqueue` nos testes.

**Correções de entrega (do diagnóstico da conta):**
- `sendTextCore` agora chama `assertSessions` antes de enviar — estabelece a sessão
  Signal com o destinatário. Era a causa do "Aguardando mensagem" (mensagem sai mas
  o aparelho não descriptografa).
- Lock de processo por conta (`process-lock.ts`) — impede 2 sockets no mesmo número
  (`conflict: replaced` / 440), que causava churn de reconexão.
- `baileysLogger` rebaixa `failed to decrypt` / `MessageCounterError` para debug.

**Comandos:** `pnpm --filter @wpp/api dev` · `pnpm worker diagnose <acctId> <num> <texto>`
(envio instrumentado para investigar entrega)

---

## Fase 4 — Inbound e webhooks ✅ CONCLUÍDA (2026-09-07)

- [x] Captura de `messages.upsert` (só `type: 'notify'`) com filtro (`inbound-filter.ts`) —
      texto 1:1, ignora grupos/status/newsletter/próprias/mídia sem legenda. 13 testes
- [x] Correlação inbound → projeto: última OUTBOUND (SENT/DELIVERED/READ) para o número em 72h (`inbound.ts`)
- [x] `inReplyTo`: quoted message (`contextInfo.stanzaId`) → messageId/externalId; sem quoted mas com conversa → última outbound
- [x] Fila `webhook` (BullMQ) + retry próprio: 0 / 30s / 2min / 10min / 1h / 6h (`webhook.ts`, `process-webhook.ts`)
- [x] Assinatura HMAC-SHA256 sobre `{timestamp}.{body_raw}` + 4 headers `X-Wpp-*`
- [x] Anti-SSRF: `checkWebhookUrl` no cadastro + resolução DNS + `isBlockedIp` a cada POST (loopback, RFC1918, 169.254, CGNAT, IPv6 ULA/link-local). Relaxado só em NODE_ENV=test
- [x] Registro em `webhook_deliveries` (PENDING → DELIVERED / FAILED, httpStatus, nextRetryAt)
- [x] Webhook `message.status` disparado em toda transição (sent/delivered/read/failed) no `process-outbound`
- [x] `POST /v1/webhook/test` — dispara webhook de teste (`bypassEventFilter`)

✅ **Critério:** 145 testes no total. `process-webhook.test.ts` sobe um Fastify local que
recebe o POST e **valida o HMAC** — confirma corpo idêntico ao assinado, retry em 5xx,
FAILED em 4xx, esgotamento após 6 tentativas. `inbound.test.ts` cobre filtro + correlação
72h + project_id null sem webhook. E2E real (responder no celular) fica pendente para
validar junto com o painel (Fase 6).

**Fila `webhook` também ganha sufixo `-test` sob NODE_ENV=test** (mesma proteção da
`outbound`). O anti-SSRF é relaxado em test para permitir o receptor em 127.0.0.1;
a lógica pura está 100% coberta em `ssrf.test.ts`.

**Opt-out (doc 06 §5):** ✅ implementado. `isOptOutRequest` detecta PARAR/SAIR/STOP/etc
no inbound, grava em `suppressed_contacts` e `isSuppressed()` bloqueia o envio na API
(texto, bulk, mídia) e de novo no worker, com erro `RECIPIENT_OPTED_OUT`. Há enum
próprio `OPT_OUT` em `AccountEventType` e tela de gestão no painel.

---

## Fase 5 — Alertas ✅ CONCLUÍDA (2026-09-07)

- [x] `AlertService` (`apps/worker/src/alerts/service.ts`) — cadeia de fallback por canal
- [x] Envio por WhatsApp via conta SAUDÁVEL do pool, nunca a que originou o alerta (`channels.ts`)
- [x] Fallback SMTP (`nodemailer`) — obrigatório para o cenário "pool vazio"
- [x] Deduplicação por `(type, entityId)` via chave Redis com TTL = janela da regra
- [x] Heurísticas de shadow-ban → quarentena (`evaluateAccountHealth`): ≥5 falhas consecutivas,
      taxa de entrega < 20% em 20 msgs, 10 envios sem ack. `PoolMonitor` roda a cada 60s
- [x] Escalonamento de `POOL_EMPTY`: marca `alert:escalate:*` para reenvio a cada 30min
- [x] Alerta em `Session.onTerminal` (ban/disconnect) via `manager.setGlobalEvents`
- [x] `PoolMonitor` também vigia: pool ≤1 conta, fila > 500 jobs

**ALERT_WHATSAPP_NUMBER editável em runtime:** nova tabela `settings` (chave-valor) +
`getSettingOr(key, envFallback)`. `pnpm worker settings <list|get|set|unset>`. O valor
da tabela vence o `.env`; cache local de 5s. Migration `20260907220118_add_settings`.

✅ **Critério:** 24 novos testes. `alerts.test.ts` (regras/dedup/heurísticas puras) +
`service.test.ts` (cadeia WhatsApp→email, dedup por entidade, escalonamento POOL_EMPTY
sem WhatsApp) + `settings.test.ts`. E2E "desconectar e receber alerta" pende de SMTP
configurado + segunda conta no pool — validar na Fase 7.

**Reuso de enums:** `account_events.type` não tem valor `QUARANTINE`/`ALERT` ainda —
o `AlertService` grava com `type: 'BAN_DETECTED'` e o tipo real vai no `detail.alert`.
(`OPT_OUT` já ganhou enum próprio; `RETENTION_FAILED` existe como `AlertType`.)

---

## Fase 6 — Painel

### Fase 6a — Núcleo operacional ✅ CONCLUÍDA (2026-09-07)

- [x] Next.js 15 (App Router) — CSS próprio enxuto (sem shadcn/Tailwind, dark theme)
- [x] Login: senha Argon2id + TOTP obrigatório (`otplib`). Fluxo de 1º acesso (setup senha + QR TOTP)
- [x] Sessão: cookie httpOnly+Secure+SameSite=Strict assinado HMAC (`PANEL_SESSION_SECRET`), 8h. Middleware protege tudo exceto /login
- [x] `/` — dashboard: cards (pool/enviadas/entrega/fila, clicáveis), volume por conta, falhas por motivo, feed de inbound
- [x] `/accounts` — lista com status/limites/entrega, ações (pausar/retomar/reconectar/remover com confirmação dupla)
- [x] `/accounts/new` — wizard de QR via **SSE** (proxy do painel → API interna do worker)
- [x] `/accounts/{id}` — timeline de account_events, últimas mensagens, limites
- [x] `/messages` + `/messages/{id}` — filtros, paginação por cursor, **timeline de tentativas** (doc 07 §4.1)
- [x] `/projects` + `/projects/{id}` — CRUD, tokens (exibido 1x), webhook (URL/secret/eventos), rate limit, quota, kill switch, log de entregas
- [x] `/settings` — número de alerta e e-mail editáveis (tabela `settings`)

**API interna do worker (novo):** `apps/worker/src/internal-api/` — Fastify na porta 3002
(NÃO publicada), auth por `INTERNAL_API_TOKEN`. Rotas: criar conta, QR (SSE),
pause/resume/reconnect/remove. O painel (server-side) é o único cliente.

**`.env` do painel:** symlink `apps/panel/.env → ../../.env` (o Next lê do próprio dir).

### Fase 6c — Chat ✅ CONCLUÍDA (2026-09-07)

- [x] `/chat` — lista de conversas derivada de `messages`, agrupadas por (contato + conta).
      Busca por texto/contato. Badge de não-lidas (INBOUND com `read_at` null)
- [x] `/chat/{contact}?account={id}` — thread com histórico, bolhas in/out, status do envio
- [x] Responder na hora pela conta que recebeu — `POST /chat/send` na API interna:
      **sem fila, sem projeto (project_id null), MAS conta nos limites hora/dia da conta**
- [x] Nova conversa por conta à escolha (com aviso anti-ban explícito)
- [x] Realtime: **SSE** `/chat/stream` (proxy → worker `chatStreamBus`, publicado no `handleInboundUpsert`)
- [x] Indicador de digitação: `POST /chat/typing` emite presence `composing` pela conta (debounce 3s)
- [x] Marcar como lida ao abrir o thread (`read_at` no INBOUND)
- [x] Envio otimista + reconciliação com o ack real

✅ **Critério:** operar o sistema inteiro sem tocar no banco ou no terminal.

### Fase 6b — Telas de operação ✅ CONCLUÍDA (2026-09-07)

- [x] `/queue` — contadores (aguardando/processando/atrasadas/falhas), lista de próximos
      jobs (prioridade, contas já tentadas, delay), ações: pausar/retomar fila,
      reprocessar falhas, limpar concluídos. Rotas em `apps/worker/src/internal-api/queue.ts`
- [x] `/alerts` — histórico dos alertas do AlertService (`account_events` com `detail.alert`),
      severidade colorida, link para a conta
- [x] Botão "Testar webhook" em `/projects/{id}` — dispara `webhook.test` via server action
      (`dispatchWebhook` com `bypassEventFilter`), resultado no log de entregas abaixo

**Ainda backlog pós-produção (não-bloqueante):** gráficos do dashboard (volume no tempo,
funil, consumo por projeto), settings completo (limites/anti-ban/retenção editáveis,
seção de segurança), realtime das contas via SSE, responsividade fina em mobile.

---

## Fase 7 — Produção AWS (~2 dias)

**7.1 — Auditoria de custos (fazer primeiro)**
- [ ] Rodar `scripts/aws-cost-audit.sh` e salvar o baseline (doc 11 §3)
- [ ] Verificar Savings Plans já existentes na conta
- [ ] Criar budget com alerta de US$50/mês

**7.2 — Provisionamento**
- [ ] Security Group (**porta 22 fechada**, acesso via SSM)
- [ ] IAM Role: SSM + ECR + S3 + Secrets Manager + CloudWatch
- [ ] EC2 `t4g.medium` arm64, EBS criptografado, IMDSv2, `DeleteOnTermination=false`
- [ ] **Elastic IP** alocado e associado
- [ ] Route53 → `<seu-dominio>`
- [ ] Secrets Manager populado + `ENCRYPTION_KEY` em cofre externo

**7.3 — Pipeline**
- [ ] Repositórios ECR (api, worker, panel)
- [ ] OIDC provider + role de deploy do GitHub
- [ ] Workflow com build `--platform linux/arm64`
- [ ] `deploy.sh` na EC2 (worker só reinicia se a imagem mudou)
- [ ] Primeiro deploy end-to-end via push na `main`

**7.4 — Operação**
- [ ] Job de manutenção (agregação, partições, limpeza)
- [ ] Bucket S3 com versionamento, criptografia e lifecycle
- [ ] Cron de backup (banco diário, sessões 6/6h)
- [ ] **Restauração testada** em instância descartável
- [ ] CloudWatch alarms + SNS + auto-recover
- [ ] Watchdog externo
- [ ] Checklist de segurança do doc 08 §8

**7.5 — Go-live**
- [ ] Conectar as 4 contas + 1 reserva, iniciar warmup
- [ ] Integrar o primeiro projeto piloto

✅ **Critério:** um projeto real enviando em produção, com pool em warmup e
deploy automatizado funcionando por push.

---

## Fase 8 — Otimização de custo (após 60 dias de produção)

- [ ] Rodar novamente `aws-cost-audit.sh` e comparar com o baseline
- [ ] Validar: contas sobreviveram? volume real confirmado?
- [ ] Conferir `EstimatedUtilization` ≥ 95%
- [ ] Comprar Compute Savings Plan com **80-90%** da recomendação (doc 11 §4)
- [ ] Avaliar Reserved Instance para o RDS MySQL existente

✅ **Critério:** custo mensal reduzido de ~US$33 para ~US$24 sem super-compromisso.

> **Por que só depois de 60 dias:** Savings Plan é irrevogável por 1 ano. Comprar
> antes de saber se as contas WhatsApp sobrevivem é comprometer-se com uma
> infraestrutura que pode não existir no mês 3.

---

## Cronograma consolidado

| Fase | Esforço | Acumulado |
|---|---|---|
| 0 — Fundação | 1 d | 1 d |
| 1 — Sessões | 2-3 d | 4 d |
| 2 — Fila | 2 d | 6 d |
| 3 — API | 2 d | 8 d |
| 4 — Inbound | 1-2 d | 10 d |
| 5 — Alertas | 1 d | 11 d |
| 6 — Painel | 3-4 d | 15 d |
| 7 — Produção AWS | 2 d | **17 d** |
| 8 — Otimização de custo | 0,5 d | *+60 dias corridos* |

**~17 dias de esforço** para o MVP completo. A Fase 8 acontece dois meses depois.

> ⚠️ **O warmup roda em paralelo, não depois.** Compre e prepare os chips (doc 06 §3)
> logo no início — 7 dias de warmup + alguns dias de uso orgânico no celular são
> tempo de calendário que não dá para acelerar. Se os chips só chegarem na Fase 7,
> a produção atrasa duas semanas por um motivo evitável.

---

## Pós-MVP

**Fase 8 — Mídia:** imagem, PDF, áudio, vídeo · storage S3 · validação MIME/tamanho

**Fase 9 — Operação:** blocklist global de opt-out · variação automática de templates ·
ordenação por destinatário · agendamento recorrente

**Fase 10 — Escala:** multi-tenant com login por projeto · sharding de contas entre
múltiplos workers · billing interno · métricas Prometheus/Grafana

---

## Ordem de leitura para implementar

1. `00-visao-geral.md` — contexto e decisões
2. `01-arquitetura.md` — como as peças se encaixam
3. `02-modelo-de-dados.md` — antes de escrever o Prisma schema
4. `04-gestao-de-contas.md` — antes da Fase 1
5. `05-fila-e-fallback.md` — antes da Fase 2 · **o documento mais denso**
6. `03-api-publica.md` — antes da Fase 3
7. `06-anti-ban.md` — consultar durante as Fases 2 e 7
8. `07-painel-admin.md` — antes da Fase 6
9. `08-seguranca-lgpd.md` + `09-infraestrutura.md` — antes da Fase 7
10. `11-custos-aws.md` — no início da Fase 7 (auditoria) e na Fase 8 (compra do SP)

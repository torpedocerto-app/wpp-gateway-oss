# 02 — Modelo de Dados

Banco: **PostgreSQL 16**. ORM: **Prisma**.

---

## 1. Diagrama de entidades

```
┌──────────────┐         ┌──────────────┐
│   projects   │────1:N──│  api_tokens  │
└──────┬───────┘         └──────┬───────┘
       │                        │
       │ 1:N                    │ 1:N
       ▼                        ▼
┌─────────────────────────────────────┐        ┌──────────────┐
│             messages                │───N:1──│   accounts   │
│  (particionada por mês)             │        └──────┬───────┘
└──────────────┬──────────────────────┘               │ 1:N
               │ 1:N                                  ▼
               ▼                            ┌──────────────────┐
      ┌──────────────────┐                  │ account_events   │
      │ message_attempts │                  └──────────────────┘
      └──────────────────┘

┌──────────────────┐   ┌──────────────────┐   ┌──────────────┐
│ webhook_deliveries│  │  daily_stats     │   │ admin_users  │
└──────────────────┘   │  (agregado)      │   └──────────────┘
                       └──────────────────┘
```

---

## 2. Entidades

### 2.1 `accounts` — contas WhatsApp do pool

Representa um número de WhatsApp conectado ao sistema.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `label` | text | Nome amigável definido pelo admin ("Atendimento 1") |
| `phone_number` | text nullable | Preenchido automaticamente após conexão (E.164) |
| `status` | enum | Ver máquina de estados abaixo |
| `session_path` | text | Caminho do diretório de credenciais Baileys |
| `is_enabled` | boolean | Chave manual do admin. Se `false`, nunca é sorteada |
| `priority` | int default 0 | Peso no sorteio. Maior = mais chance |
| `daily_limit` | int default 300 | Teto de mensagens/dia desta conta |
| `hourly_limit` | int default 40 | Teto de mensagens/hora desta conta |
| `connected_at` | timestamptz nullable | Quando conectou pela última vez |
| `last_seen_at` | timestamptz nullable | Último heartbeat bem-sucedido |
| `last_error` | text nullable | Última mensagem de erro registrada |
| `consecutive_failures` | int default 0 | Zerado a cada sucesso. Ver doc 05 |
| `banned_at` | timestamptz nullable | Quando foi detectado o banimento |
| `warmup_until` | timestamptz nullable | Durante warmup, limites reduzidos |
| `created_at` / `updated_at` | timestamptz | |

**Máquina de estados de `status`:**

```
                    ┌──────────────┐
      criar conta → │ DISCONNECTED │ ←──────────────┐
                    └──────┬───────┘                │
                           │ admin pede QR          │ logout / erro
                           ▼                        │
                    ┌──────────────┐                │
                    │ QR_PENDING   │ ── expira ─────┤
                    └──────┬───────┘                │
                           │ scan OK                │
                           ▼                        │
                    ┌──────────────┐                │
              ┌───► │  CONNECTED   │ ───────────────┤
              │     └──────┬───────┘                │
              │            │ falha transitória      │
   reconecta  │            ▼                        │
              │     ┌──────────────┐                │
              └──── │ RECONNECTING │ ── esgotou ────┘
                    └──────────────┘   tentativas
                           │
                           │ erro 401/403 do WhatsApp
                           ▼
                    ┌──────────────┐
                    │    BANNED    │ ← terminal, exige ação manual
                    └──────────────┘
```

> **Regra:** apenas contas em `CONNECTED` **e** `is_enabled = true` **e** dentro dos
> limites horário/diário são elegíveis para o sorteio.

---

### 2.2 `projects` — sistemas consumidores da API

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | "CRM Clínica", "E-commerce" |
| `slug` | text unique | Identificador curto |
| `webhook_url` | text nullable | Destino dos eventos inbound e de status |
| `webhook_secret` | text nullable | Segredo para assinatura HMAC-SHA256 |
| `webhook_events` | text[] | Quais eventos enviar: `message.status`, `message.received` |
| `rate_limit_per_minute` | int default 60 | Teto de requisições à API |
| `daily_quota` | int nullable | Teto de mensagens/dia. `null` = ilimitado |
| `is_active` | boolean | Kill switch do projeto inteiro |
| `created_at` / `updated_at` | timestamptz | |

---

### 2.3 `api_tokens` — credenciais de acesso

Um projeto pode ter múltiplos tokens (produção, staging, rotação).

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK | |
| `name` | text | "Produção", "Homologação" |
| `token_hash` | text unique | **SHA-256 do token.** Nunca o token em claro |
| `token_prefix` | text | Primeiros 12 chars, para exibir no painel |
| `last_used_at` | timestamptz nullable | |
| `expires_at` | timestamptz nullable | `null` = não expira |
| `revoked_at` | timestamptz nullable | |
| `created_at` | timestamptz | |

**Formato do token:** `mk_live_<32 bytes aleatórios em base62>`
Exibido **uma única vez** na criação. Depois, só o prefixo.

> **Por que hash e não criptografia:** o sistema nunca precisa recuperar o token
> original — só verificar se um token apresentado confere. Hash é irreversível,
> então um dump do banco não expõe credenciais utilizáveis.

---

### 2.4 `messages` — registro central

Tabela **particionada por mês** (`RANGE` em `created_at`), para permitir descarte
barato de partições antigas na rotina de retenção.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK nullable | `null` para inbound não atribuído |
| `api_token_id` | uuid FK nullable | Qual token originou (auditoria) |
| `account_id` | uuid FK nullable | Conta que efetivamente enviou/recebeu |
| `direction` | enum | `OUTBOUND` \| `INBOUND` |
| `status` | enum | Ver máquina de estados abaixo |
| `to_number` | text | E.164 normalizado |
| `from_number` | text nullable | Preenchido no inbound |
| `content` | text | Corpo da mensagem |
| `external_id` | text nullable | ID do cliente, para idempotência |
| `whatsapp_message_id` | text nullable | ID retornado pelo WhatsApp |
| `error_code` | text nullable | Código da taxonomia (doc 05) |
| `error_message` | text nullable | |
| `attempt_count` | int default 0 | |
| `scheduled_for` | timestamptz nullable | Envio agendado |
| `queued_at` / `sent_at` / `delivered_at` / `read_at` / `failed_at` | timestamptz nullable | |
| `created_at` | timestamptz | Chave de particionamento |

**Máquina de estados de `status` (outbound):**

```
QUEUED ──► SENDING ──► SENT ──► DELIVERED ──► READ
   │           │                    (ack do WhatsApp)
   │           │
   │           └──► FAILED ──► (se transitório) volta para QUEUED
   │                              com outra conta
   │
   └──► CANCELED (admin cancelou antes do envio)
```

**Índices:**
```sql
CREATE INDEX ON messages (project_id, created_at DESC);
CREATE INDEX ON messages (account_id, created_at DESC);
CREATE INDEX ON messages (status) WHERE status IN ('QUEUED','SENDING');
CREATE INDEX ON messages (to_number, created_at DESC);
CREATE UNIQUE INDEX ON messages (project_id, external_id)
  WHERE external_id IS NOT NULL;  -- idempotência
```

---

### 2.5 `message_attempts` — histórico de tentativas

Cada tentativa de envio, incluindo as que falharam e geraram fallback.
**É o que permite auditar por que uma mensagem demorou ou por qual conta passou.**

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `message_id` | uuid FK | |
| `account_id` | uuid FK | Conta usada nesta tentativa |
| `attempt_number` | int | 1, 2, 3… |
| `result` | enum | `SUCCESS` \| `FAILED` |
| `error_code` | text nullable | |
| `error_message` | text nullable | |
| `duration_ms` | int | Latência do envio |
| `created_at` | timestamptz | |

---

### 2.6 `account_events` — auditoria das contas

Toda transição de estado e evento relevante de uma conta.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid FK | |
| `type` | enum | `CONNECTED`, `DISCONNECTED`, `QR_GENERATED`, `BAN_DETECTED`, `RECONNECT_ATTEMPT`, `MANUALLY_DISABLED`, `LIMIT_REACHED` |
| `detail` | jsonb | Payload livre com contexto |
| `created_at` | timestamptz | |

---

### 2.7 `webhook_deliveries` — entregas de webhook

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK | |
| `message_id` | uuid FK nullable | |
| `event_type` | text | `message.status` \| `message.received` |
| `payload` | jsonb | O que foi enviado |
| `status` | enum | `PENDING` \| `DELIVERED` \| `FAILED` |
| `http_status` | int nullable | |
| `attempt_count` | int default 0 | |
| `next_retry_at` | timestamptz nullable | |
| `created_at` / `delivered_at` | timestamptz | |

---

### 2.8 `daily_stats` — agregado para retenção longa

Preenchido por job noturno. Sobrevive ao descarte das partições de `messages`,
preservando o histórico estatístico além dos 90 dias.

| Campo | Tipo |
|---|---|
| `id` | uuid PK |
| `date` | date |
| `project_id` | uuid FK nullable |
| `account_id` | uuid FK nullable |
| `sent_count` / `delivered_count` / `read_count` / `failed_count` / `received_count` | int |
| `error_breakdown` | jsonb — `{ "NUMBER_NOT_ON_WHATSAPP": 12, ... }` |

`UNIQUE (date, project_id, account_id)`

---

### 2.9 `admin_users` — acesso ao painel

Multi-usuário: N linhas por tenant. Gestão na tela Usuários do painel.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `email` | text unique | |
| `name` | text nullable | nome exibido |
| `password_hash` | text | **Argon2id**; `'SETUP_PENDING'` = criado mas sem senha (convite / seed / admin-create.sh) |
| `totp_secret` | text nullable | 2FA, criptografado em repouso |
| `totp_enabled` | boolean | |
| `last_login_at` | timestamptz nullable | |
| `disabled_at` | timestamptz nullable | desativado sem apagar; `requireSession` recusa a sessão |
| `invited_by_id` | uuid nullable → `admin_users.id` | quem convidou (`ON DELETE SET NULL`) |
| `locale` | varchar(5), default `'pt'` | idioma do painel/e-mails deste usuário (`pt`\|`es`\|`en`, validado no app — doc 12) |
| `created_at` | timestamptz | |

### 2.10 `admin_tokens` — tokens de uso único do painel

Recuperação de senha e convite. Guarda só o sha256 (`token_hash`), nunca o valor cru.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid → `admin_users.id` | `ON DELETE CASCADE` |
| `purpose` | enum `RESET` \| `INVITE` | TTL 30 min / 72 h |
| `token_hash` | text unique | sha256 hex do token; é o índice de lookup |
| `expires_at` | timestamptz | |
| `used_at` | timestamptz nullable | marca consumo (uso único) |
| `created_at` | timestamptz | |

---

## 3. Política de retenção

| Dado | Retenção | Mecanismo |
|---|---|---|
| `messages` (com `content`) | `RETENTION_DAYS` (90) | `DROP PARTITION` mensal |
| `message_attempts` | Junto da mensagem | Delete de órfãs após o drop |
| `daily_stats` | Indefinido | Agregado, sem dado pessoal |
| `account_events` | 1 ano | Delete por data |
| `webhook_deliveries` | 30 dias | Delete por data |

**Implementado** em `apps/worker/src/retention/` — agendado pelo próprio worker
(instância única, ADR-002), às 03:00 no fuso do tenant, dentro da janela de
silêncio. Execução manual: `pnpm worker retention:run`.

**Ordem do job:**
1. **Cria partições** do mês corrente + 2 à frente (passo crítico, roda primeiro)
2. Descarta partições de `messages` inteiramente fora da janela
3. Apaga `message_attempts` órfãs, se algo foi descartado
4. Limpa `account_events` (> 1 ano) e `webhook_deliveries` (> 30 dias)

> ⚠️ A criação antecipada de partições é crítica: se a partição do mês seguinte não
> existir, **todo INSERT em `messages` falha** na virada do mês. Por isso é o passo
> 1 e, se falhar, dispara `RETENTION_FAILED` (CRITICAL, com escalation) e aborta o
> resto do ciclo. O worker também executa uma passada no boot, para corrigir na
> hora um deploy que suba num mês sem partição.

> **`message_attempts` não sai por cascade.** A FK dela aponta para `accounts`,
> não para `messages` — dropar a partição deixaria as tentativas órfãs para
> sempre. O passo 3 existe por isso, e só varre quando houve descarte.

**Granularidade do descarte:** como a partição é mensal, ela só cai quando o mês
INTEIRO está fora da janela. Com 90 dias, uma mensagem vive entre 90 e ~120 dias.
O arredondamento é deliberadamente para o lado conservador — nunca apaga antes
do contratado.

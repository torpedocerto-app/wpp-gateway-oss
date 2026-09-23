# 03 — API Pública

Contrato consumido pelos projetos da holding.

> Este documento é a fonte técnica interna. Uma versão pública, traduzida
> (pt/es/en) e sem necessidade de login, fica disponível em `/docs/api` no
> painel de cada tenant — pensada para compartilhar com devs/IAs de terceiros
> que forem integrar sem acesso ao repositório.

**Base URL:** `https://<seu-dominio>/v1`
**Autenticação:** `Authorization: Bearer mk_live_xxxxx`
**Formato:** JSON (`Content-Type: application/json`)

---

## 1. Princípios do contrato

1. **Idempotência obrigatória** — todo envio aceita `externalId`. Reenviar o mesmo
   `externalId` retorna a mensagem original em vez de duplicar. Protege contra
   retry do cliente e duplo clique.
2. **Assíncrono sempre** — envio responde `202 Accepted`. O status final chega
   por webhook ou consulta.
3. **Erros previsíveis** — todo erro tem `code` estável (string) além do HTTP status.
   Clientes devem programar contra o `code`, nunca contra a mensagem.
4. **Versionado na URL** — `/v1`. Mudanças incompatíveis criam `/v2`.

---

## 2. Autenticação

```http
Authorization: Bearer mk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

| Situação | HTTP | `code` |
|---|---|---|
| Header ausente ou malformado | 401 | `MISSING_TOKEN` |
| Token inexistente | 401 | `INVALID_TOKEN` |
| Token revogado | 401 | `TOKEN_REVOKED` |
| Token expirado | 401 | `TOKEN_EXPIRED` |
| Projeto desativado | 403 | `PROJECT_INACTIVE` |

A validação compara o **SHA-256** do token apresentado com `api_tokens.token_hash`.
O resultado é cacheado em Redis por 60s para evitar hit no banco a cada requisição.

---

## 3. Endpoints

### 3.1 `POST /v1/messages` — enviar mensagem

**Request**
```json
{
  "to": "5511999998888",
  "text": "Olá! Sua consulta está confirmada para amanhã às 14h.",
  "externalId": "consulta-4711-confirmacao",
  "scheduledFor": "2026-09-08T10:00:00Z",
  "preferredAccountId": null
}
```

| Campo | Tipo | Obrigatório | Regras |
|---|---|---|---|
| `to` | string | ✅ | Telefone. Aceita formatos variados, é normalizado para E.164. Ver §5 |
| `text` | string | ✅ | 1 a 4096 caracteres |
| `externalId` | string | ❌ | Até 128 chars. Único por projeto. Habilita idempotência |
| `scheduledFor` | ISO 8601 | ❌ | Futuro, no máximo +30 dias. Ausente = envia assim que possível |
| `preferredAccountId` | uuid | ❌ | Tenta essa conta primeiro. Se indisponível, sorteia normalmente |

**Response `202 Accepted`**
```json
{
  "messageId": "01J8X4K2M9P7Q3R5T6V8W0Y2Z4",
  "status": "queued",
  "to": "5511999998888",
  "externalId": "consulta-4711-confirmacao",
  "estimatedSendAt": "2026-09-07T14:32:18Z",
  "createdAt": "2026-09-07T14:32:05Z"
}
```

**Response `200 OK`** — idempotência: `externalId` já existente. Retorna a mensagem
original sem criar nova, com o status atual dela.

**Erros específicos**

| HTTP | `code` | Quando |
|---|---|---|
| 422 | `INVALID_PHONE_NUMBER` | Telefone não normalizável |
| 422 | `TEXT_TOO_LONG` | Acima de 4096 chars |
| 422 | `INVALID_SCHEDULE` | Data no passado ou além de 30 dias |
| 429 | `RATE_LIMIT_EXCEEDED` | Excedeu `rate_limit_per_minute`. Header `Retry-After` |
| 429 | `DAILY_QUOTA_EXCEEDED` | Excedeu `daily_quota` do projeto |
| 503 | `NO_ACCOUNTS_AVAILABLE` | Nenhuma conta saudável. **Ver nota abaixo** |

> **Nota sobre `NO_ACCOUNTS_AVAILABLE`:** por padrão a mensagem é **aceita e enfileirada**
> mesmo sem conta disponível — ela aguarda até uma conta voltar. O `503` só é retornado
> se o projeto enviar o header `X-Reject-If-Unavailable: true`, útil para mensagens
> sensíveis ao tempo (ex: OTP) que não fazem sentido entregues com atraso.

---

### 3.2 `POST /v1/messages/bulk` — envio em lote

Até **500 destinatários** por requisição. Cada um vira uma mensagem independente,
distribuída entre contas com jitter.

**Request**
```json
{
  "messages": [
    { "to": "5511999998888", "text": "Olá João!", "externalId": "lote-1-joao" },
    { "to": "5511988887777", "text": "Olá Maria!", "externalId": "lote-1-maria" }
  ]
}
```

**Response `202 Accepted`** — validação parcial: itens válidos são aceitos,
inválidos são reportados individualmente.
```json
{
  "accepted": 1,
  "rejected": 1,
  "messages": [
    { "index": 0, "messageId": "01J8X...", "status": "queued" }
  ],
  "errors": [
    { "index": 1, "code": "INVALID_PHONE_NUMBER", "message": "Número inválido" }
  ]
}
```

---

### 3.3 `POST /v1/messages/media` — enviar imagem ou PDF

Único endpoint da API com contrato **multipart/form-data** (não JSON) — os outros
não mudam. Só destinatário único, sem versão bulk.

**Request** (`multipart/form-data`)

| Campo | Obrigatório | Descrição |
|---|---|---|
| `to` | ✅ | Telefone, mesma normalização dos outros endpoints |
| `file` | ✅ | Arquivo — imagem (`jpeg`/`png`/`webp`) ou `PDF`, até **16MB** |
| `caption` | — | Legenda (texto que acompanha a mídia) |
| `externalId` | — | Idempotência, igual `/v1/messages` |

**Response `202 Accepted`** — mesmo formato de `/v1/messages`:
```json
{
  "messageId": "01J8X...",
  "status": "queued",
  "to": "+5511999998888",
  "externalId": "relatorio-sexta-w37",
  "createdAt": "2026-09-11T14:00:00Z"
}
```

> Os bytes do arquivo trafegam só entre a API e o worker (via job da fila);
> nunca são persistidos no Postgres — só metadata (`mimetype`, nome do arquivo)
> fica em `messages`. Ver `05-fila-e-fallback.md §7`.

---

### 3.4 `GET /v1/messages/{messageId}` — consultar status

```json
{
  "messageId": "01J8X4K2M9P7Q3R5T6V8W0Y2Z4",
  "status": "delivered",
  "to": "5511999998888",
  "text": "Olá! Sua consulta...",
  "externalId": "consulta-4711-confirmacao",
  "attemptCount": 1,
  "timeline": {
    "createdAt":   "2026-09-07T14:32:05Z",
    "queuedAt":    "2026-09-07T14:32:05Z",
    "sentAt":      "2026-09-07T14:32:19Z",
    "deliveredAt": "2026-09-07T14:32:24Z",
    "readAt":      null
  },
  "error": null
}
```

Em caso de falha:
```json
{
  "status": "failed",
  "error": {
    "code": "NUMBER_NOT_ON_WHATSAPP",
    "message": "O número de destino não possui WhatsApp",
    "retryable": false
  }
}
```

> O projeto **só enxerga suas próprias mensagens**. Consultar o `messageId` de outro
> projeto retorna `404 MESSAGE_NOT_FOUND` (não `403`, para não vazar existência).

---

### 3.5 `GET /v1/messages` — listar mensagens

Query params: `status`, `direction`, `to`, `from`, `until`, `limit` (máx 100), `cursor`.

Paginação por cursor:
```json
{
  "data": [ /* … */ ],
  "pagination": { "nextCursor": "eyJpZCI6IjAxSjhY…", "hasMore": true }
}
```

---

### 3.6 `POST /v1/messages/{messageId}/cancel`

Cancela uma mensagem ainda em `QUEUED`. Retorna `409 MESSAGE_NOT_CANCELABLE`
se já estiver em `SENDING` ou posterior.

---

### 3.7 `GET /v1/health` — saúde do pool

Não expõe números de telefone (o projeto consumidor não precisa saber quais são).
```json
{
  "status": "healthy",
  "accountsTotal": 5,
  "accountsAvailable": 4,
  "queueDepth": 12,
  "estimatedDelaySeconds": 45
}
```
`status`: `healthy` (≥2 contas) · `degraded` (1 conta) · `unavailable` (0 contas)

---

## 4. Webhooks

O gateway faz `POST` no `webhook_url` do projeto.

### 4.1 Assinatura

```http
POST /seu-endpoint HTTP/1.1
X-Wpp-Signature: sha256=5d41402abc4b2a76b9719d911017c592
X-Wpp-Timestamp: 1757251925
X-Wpp-Event: message.received
X-Wpp-Delivery: 01J8X4K2M9P7Q3R5T6V8W0Y2Z4
```

Cálculo: `HMAC-SHA256(webhook_secret, "{timestamp}.{body_raw}")`

> **Validação obrigatória no consumidor:**
> 1. Recalcular o HMAC sobre o **corpo bruto** (antes de qualquer parse de JSON)
> 2. Comparar com **comparação em tempo constante** (`crypto.timingSafeEqual`)
> 3. **Rejeitar timestamps com mais de 5 minutos** — sem isso, um atacante que
>    capturou um webhook antigo pode reenviá-lo indefinidamente (replay attack)

### 4.2 Evento `message.status`
```json
{
  "event": "message.status",
  "timestamp": "2026-09-07T14:32:24Z",
  "data": {
    "messageId": "01J8X4K2M9P7Q3R5T6V8W0Y2Z4",
    "externalId": "consulta-4711-confirmacao",
    "status": "delivered",
    "to": "5511999998888",
    "error": null
  }
}
```
Disparado em: `sent`, `delivered`, `read`, `failed`.

### 4.3 Evento `message.received` (inbound)
```json
{
  "event": "message.received",
  "timestamp": "2026-09-07T14:40:11Z",
  "data": {
    "messageId": "01J8X5N3P0Q8R4S6U7W9Y1Z3A5",
    "from": "5511999998888",
    "text": "Confirmado, obrigado!",
    "receivedAt": "2026-09-07T14:40:10Z",
    "inReplyTo": {
      "messageId": "01J8X4K2M9P7Q3R5T6V8W0Y2Z4",
      "externalId": "consulta-4711-confirmacao"
    }
  }
}
```

### 4.4 Política de retry

| Tentativa | Delay |
|---|---|
| 1 | imediato |
| 2 | 30 s |
| 3 | 2 min |
| 4 | 10 min |
| 5 | 1 h |
| 6 | 6 h |

Sucesso = HTTP **2xx** em até 10 s. Após 6 falhas, marca `FAILED` e alerta no painel.
`4xx` (exceto 429) **não** é retentado — indica erro de configuração do consumidor.

> **O consumidor deve responder 2xx imediatamente e processar em background.**
> Processar de forma síncrona antes de responder causa timeout e retry desnecessário.

---

## 5. Normalização de telefone

Todo número é normalizado para **E.164** antes de qualquer operação.

| Entrada | Normalizado |
|---|---|
| `11999998888` | `+5511999998888` (assume BR) |
| `(11) 99999-8888` | `+5511999998888` |
| `5511999998888` | `+5511999998888` |
| `+55 11 99999-8888` | `+5511999998888` |

**Regra do nono dígito (Brasil):** celulares brasileiros têm 9 dígitos após o DDD,
mas o WhatsApp mantém internamente números antigos de 8 dígitos para algumas regiões.
A biblioteca `libphonenumber-js` faz a normalização; a **verificação de existência no
WhatsApp** (`onWhatsApp()` do Baileys) é a fonte de verdade final e roda antes do envio.

O resultado dessa verificação é cacheado em Redis por **7 dias**, evitando consultas
repetidas ao WhatsApp — que são, elas próprias, um sinal de comportamento automatizado.

---

## 6. Rate limiting

Dois níveis independentes:

| Nível | Limite | Escopo |
|---|---|---|
| **Requisições HTTP** | `rate_limit_per_minute` (default 60) | Por token |
| **Mensagens/dia** | `daily_quota` | Por projeto |

Headers em toda resposta:
```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1757251980
```

> ⚠️ Estes são limites **da API**, não do WhatsApp. Os limites anti-ban por conta
> são aplicados no worker e independem destes — ver `06-anti-ban.md`.

---

## 7. Catálogo de códigos de erro

| `code` | HTTP | Retryable | Significado |
|---|---|---|---|
| `MISSING_TOKEN` | 401 | ❌ | Header ausente |
| `INVALID_TOKEN` | 401 | ❌ | Token não existe |
| `TOKEN_REVOKED` | 401 | ❌ | Token revogado |
| `TOKEN_EXPIRED` | 401 | ❌ | Token expirado |
| `PROJECT_INACTIVE` | 403 | ❌ | Projeto desativado |
| `MESSAGE_NOT_FOUND` | 404 | ❌ | Não existe ou é de outro projeto |
| `MESSAGE_NOT_CANCELABLE` | 409 | ❌ | Já saiu da fila |
| `INVALID_PHONE_NUMBER` | 422 | ❌ | Não normalizável |
| `TEXT_TOO_LONG` | 422 | ❌ | > 4096 chars |
| `INVALID_SCHEDULE` | 422 | ❌ | Data inválida |
| `RECIPIENT_OPTED_OUT` | 422 | ❌ | Destinatário pediu opt-out (doc 06 §5) |
| `MISSING_MEDIA_FILE` | 422 | ❌ | `POST /messages/media` sem arquivo |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | ❌ | Mimetype fora da allowlist |
| `MEDIA_TOO_LARGE` | 413 | ❌ | Arquivo acima de 16MB |
| `RATE_LIMIT_EXCEEDED` | 429 | ✅ | Respeitar `Retry-After` |
| `DAILY_QUOTA_EXCEEDED` | 429 | ✅ | Só no dia seguinte |
| `NO_ACCOUNTS_AVAILABLE` | 503 | ✅ | Pool indisponível |
| `INTERNAL_ERROR` | 500 | ✅ | Erro inesperado |

Formato padrão de erro:
```json
{
  "error": {
    "code": "INVALID_PHONE_NUMBER",
    "message": "O número informado não é válido",
    "details": { "field": "to", "value": "119999" }
  }
}
```

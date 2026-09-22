# 04 — Gestão de Contas WhatsApp

Ciclo de vida das sessões, pareamento por QR, detecção de banimento e alertas.

---

## 1. Adicionar uma conta (fluxo do QR)

```
Admin no painel                Worker                    WhatsApp
      │                          │                          │
      │ 1. "Adicionar conta"     │                          │
      │    (informa o label)     │                          │
      ├─────────────────────────►│                          │
      │                          │ 2. cria account          │
      │                          │    status=DISCONNECTED   │
      │                          │                          │
      │ 3. abre SSE              │                          │
      │    /accounts/{id}/qr     │                          │
      ├─────────────────────────►│ 4. inicia socket Baileys │
      │                          ├─────────────────────────►│
      │                          │ 5. evento connection.    │
      │                          │    update com o QR       │
      │                          │◄─────────────────────────┤
      │ 6. QR via SSE            │                          │
      │◄─────────────────────────┤ status=QR_PENDING        │
      │                          │                          │
      │ 7. admin escaneia no celular ────────────────────────►
      │                          │                          │
      │                          │ 8. connection: 'open'    │
      │                          │◄─────────────────────────┤
      │ 9. "Conectado ✓"         │ status=CONNECTED         │
      │◄─────────────────────────┤ salva phone_number       │
      │                          │ salva credenciais        │
```

**Detalhes operacionais:**
- O QR expira a cada **~20 segundos**; o Baileys emite um novo automaticamente.
  O painel deve substituir a imagem sem recarregar a página.
- Após **5 QRs não escaneados** (~100 s), a tentativa é abortada, o socket fechado
  e o status volta para `DISCONNECTED`. Evita socket órfão consumindo recurso.
- Ao conectar, o `phone_number` é extraído de `sock.user.id` e gravado.
- **Toda conta nova entra em warmup** por 7 dias (ver `06-anti-ban.md`).

---

## 2. Persistência de sessão

O Baileys grava credenciais via `useMultiFileAuthState` em um diretório por conta:

```
/data/sessions/
  ├── {account-uuid-1}/
  │     ├── creds.json          ← credenciais principais
  │     └── app-state-sync-*.json
  └── {account-uuid-2}/
```

**Regras invioláveis:**
1. O diretório é um **volume Docker persistente**. Perder esses arquivos = perder a
   sessão = escanear o QR de novo (e reconexões frequentes são sinal de risco).
2. **Nunca** duas instâncias do worker usando o mesmo diretório — corrompe as
   credenciais e derruba a conta.
3. Backup diário criptografado (ver `09-infraestrutura.md`).
4. O diretório contém material criptográfico sensível: permissão `0700`,
   volume com criptografia em repouso.

---

## 3. Detecção de desconexão e banimento

O Baileys emite `connection.update` com `lastDisconnect.error` contendo um
`DisconnectReason`. **A classificação correta desse motivo é o coração do sistema** —
tratar um ban como falha transitória gera reconexões infinitas contra uma conta morta.

| `DisconnectReason` | Código | Interpretação | Ação |
|---|---|---|---|
| `loggedOut` | 401 | **Sessão encerrada/banida** | → `BANNED`, apaga credenciais, **alerta** |
| `forbidden` | 403 | **Conta bloqueada pela Meta** | → `BANNED`, **alerta** |
| `badSession` | 500 | Fallback do Baileys p/ `<stream:error>` sem código reconhecido (não é ban) | Reconecta com backoff, sem apagar credenciais, sem alerta |
| `connectionReplaced` | 440 | Outra sessão assumiu | → `DISCONNECTED`, **não** reconecta, alerta |
| `restartRequired` | 515 | Reinício normal do protocolo | Reconecta imediatamente |
| `connectionClosed` | 428 | Queda de rede | Reconecta com backoff |
| `connectionLost` | 408 | Timeout | Reconecta com backoff |
| `timedOut` | 408 | Timeout | Reconecta com backoff |
| `multideviceMismatch` | 411 | Incompatibilidade multi-device | → `BANNED`, novo QR |

```ts
// Pseudocódigo da decisão
const TERMINAL = [401, 403, 411, 440, 500];

function onDisconnect(accountId, statusCode) {
  if (TERMINAL.includes(statusCode)) {
    setStatus(accountId, statusCode === 440 ? 'DISCONNECTED' : 'BANNED');
    if (statusCode !== 440) wipeCredentials(accountId);
    emitAlert(accountId, statusCode);
    return;               // NÃO reconecta
  }
  scheduleReconnect(accountId);   // backoff exponencial
}
```

### 3.1 Reconexão com backoff

Para causas transitórias apenas:

| Tentativa | Delay |
|---|---|
| 1 | 5 s |
| 2 | 15 s |
| 3 | 45 s |
| 4 | 2 min |
| 5 | 5 min |
| 6+ | 15 min (teto) |

Após **10 tentativas consecutivas** sem sucesso, a conta é marcada `DISCONNECTED`,
removida do pool e gera alerta — mesmo que a causa fosse teoricamente transitória.
Uma conta que não reconecta em ~40 minutos exige olho humano.

O contador zera a cada conexão bem-sucedida.

---

## 4. Sinais indiretos de banimento

Nem todo bloqueio se manifesta como desconexão. O WhatsApp aplica *shadow bans* em que
a conta segue conectada mas as mensagens não chegam. Heurísticas de detecção:

| Sinal | Limiar | Ação |
|---|---|---|
| Falhas consecutivas de envio na mesma conta | ≥ 5 | Suspende a conta por 30 min, alerta |
| Taxa de `DELIVERED` da conta despenca | < 20% em 20 mensagens | Marca como suspeita, alerta |
| Envios "com sucesso" mas sem nenhum ack de entrega | 10 seguidos | Marca como suspeita, alerta |
| Conta não recebe nenhum inbound há muito tempo | 7 dias com >100 envios | Alerta informativo (sinal fraco) |

> **Suspensão ≠ banimento.** Uma conta suspeita entra em quarentena (removida do
> sorteio) mas mantém a sessão viva. Só o admin decide remover — automatizar essa
> decisão terminal seria arriscado demais.

---

## 5. Health check

Job a cada **60 segundos** para cada conta em `CONNECTED`:

1. Verifica se o socket está aberto (`sock.ws.readyState === OPEN`)
2. Atualiza `last_seen_at`
3. Se `last_seen_at` está defasado > 5 min, força reconexão
4. Recalcula contadores de limite horário/diário
5. Reavalia as heurísticas da §4

> **Não use envio de mensagem como health check.** Enviar para si mesmo
> periodicamente cria exatamente o padrão robótico que se quer evitar.

---

## 6. Sistema de alertas

### 6.1 Canal primário: WhatsApp

O alerta é enviado para o **número do admin** usando uma **conta saudável do pool**
diferente da que falhou.

```
🚨 ALERTA — wpp-gateway

Conta: "Atendimento 2" (+5511988887777)
Evento: BANIMENTO DETECTADO
Motivo: loggedOut (401)
Horário: 07/09/2026 14:32

A conta foi removida do pool automaticamente.
Pool restante: 3 de 4 contas ativas.

→ ${PANEL_PUBLIC_URL}/accounts/{id}
```

### 6.2 Cadeia de fallback

```
1. WhatsApp via conta saudável do pool
       │ nenhuma conta saudável, ou envio falhou
       ▼
2. E-mail (SMTP)  ← configuração obrigatória
       │ falhou
       ▼
3. Registro em account_events + badge no painel
```

> **Por que o e-mail é obrigatório:** o cenário mais crítico é justamente o pool
> inteiro cair. Nesse momento o canal primário não existe. Um sistema que só alerta
> por WhatsApp fica mudo exatamente quando você mais precisa saber.

### 6.3 Eventos que geram alerta

| Evento | Severidade | Canal |
|---|---|---|
| Conta banida | 🔴 Crítico | WhatsApp + e-mail |
| Conta desconectada (esgotou reconexões) | 🟠 Alto | WhatsApp + e-mail |
| Pool com ≤ 1 conta ativa | 🔴 Crítico | WhatsApp + e-mail |
| **Pool com 0 contas ativas** | 🔴 Crítico | E-mail (WhatsApp impossível) |
| Conta suspeita (heurística §4) | 🟡 Médio | WhatsApp |
| Conta atingiu limite diário | 🔵 Info | Painel |
| Fila acima de 500 jobs | 🟠 Alto | WhatsApp |
| Webhook falhando há > 1h | 🟡 Médio | Painel + e-mail |

### 6.4 Anti-flood de alertas

- **Deduplicação:** o mesmo evento na mesma conta não repete por 1 hora
- **Agrupamento:** múltiplos eventos em 5 min viram um alerta consolidado
- **Escalonamento:** "pool com 0 contas" reenvia a cada 30 min até ser resolvido

---

## 7. Operações do admin sobre uma conta

| Ação | Efeito |
|---|---|
| **Pausar** | `is_enabled = false`. Sai do sorteio, sessão permanece viva |
| **Retomar** | `is_enabled = true`. Volta ao sorteio |
| **Reconectar** | Força novo ciclo de conexão com as credenciais atuais |
| **Regerar QR** | Apaga credenciais e inicia novo pareamento. ⚠️ Irreversível |
| **Remover** | Faz logout no WhatsApp, apaga credenciais, marca conta como deletada |
| **Ajustar limites** | Altera `daily_limit` / `hourly_limit` / `priority` |

> **Logout explícito ao remover:** chamar `sock.logout()` desassocia o dispositivo
> no aparelho do usuário. Apenas apagar os arquivos deixa um "dispositivo fantasma"
> listado no WhatsApp do celular.

---

## 8. Substituir uma conta banida

Procedimento manual documentado para quando o alerta chegar:

1. Abrir a conta banida no painel → confirmar o motivo em `account_events`
2. Clicar **Remover** (a conta banida não permite logout; só limpa o registro)
3. Criar nova conta com **novo chip/número** — reusar o mesmo número banido
   costuma resultar em novo banimento imediato
4. Parear via QR
5. A conta entra em **warmup de 7 dias** automaticamente (limites reduzidos)
6. Verificar no dashboard se o pool voltou ao tamanho-alvo (≥ 4 contas)

> **Mantenha 1 conta reserva pausada.** Ter um número já pareado e "aquecido",
> pausado no painel, transforma uma substituição de emergência (que levaria dias de
> warmup) em um clique de "Retomar".

# 05 — Fila, Sorteio de Conta e Fallback

O núcleo da lógica de negócio. **Este é o documento mais crítico da implementação.**

---

## 1. Filas (BullMQ / Redis)

| Fila | Função | Concorrência |
|---|---|---|
| `outbound` | Envio de mensagens | 1 por conta (ver §2.1) |
| `webhook` | Entrega de webhooks aos projetos | 10 |
| `maintenance` | Health check, agregação, limpeza | 1 |

### 1.1 Prioridades na fila `outbound`

| Prioridade | Uso |
|---|---|
| 1 (maior) | Retry de fallback — mensagem já falhou, não pode esperar mais |
| 5 | Envio normal |
| 10 (menor) | Envio em lote (`/bulk`) |

Prioridade menor não significa "pode falhar" — significa que envios individuais e
retries passam à frente de um lote grande, evitando que uma campanha de 500 mensagens
atrase uma confirmação de consulta.

---

## 2. Algoritmo de sorteio de conta

### 2.1 Elegibilidade

Uma conta só entra no sorteio se **todas** as condições forem verdadeiras:

```ts
elegivel(conta) =
     conta.status === 'CONNECTED'
  && conta.is_enabled === true
  && conta.socket_aberto === true
  && enviadas_na_ultima_hora(conta) < conta.hourly_limit
  && enviadas_hoje(conta)           < conta.daily_limit
  && !em_quarentena(conta)              // suspeita, doc 04 §4
  && !em_cooldown(conta)                // intervalo mínimo entre envios
  && !bloqueada_por_lock(conta)         // já enviando outra mensagem
```

> **Lock por conta:** cada conta processa **uma mensagem por vez**. Implementado com
> lock em Redis (`SET account:{id}:lock NX EX 30`). Sem isso, dois jobs paralelos
> enviariam simultaneamente pela mesma conta — humanamente impossível e um sinal
> claro de automação.

### 2.2 Sorteio ponderado

Entre as elegíveis, o sorteio é **aleatório ponderado** — não round-robin.

> **Por que não round-robin:** round-robin é perfeitamente previsível. Se a Meta
> correlacionar envios entre números, a rotação A→B→C→A→B→C é um padrão evidente.
> Aleatoriedade real não produz sequência reconhecível.

**Peso de cada conta:**

```
peso = base
     × fator_capacidade      // quanto mais folga no limite diário, maior o peso
     × fator_saude           // taxa de entrega recente
     × fator_descanso        // tempo desde o último envio
     × fator_warmup          // 0.3 durante warmup
```

| Fator | Cálculo | Efeito |
|---|---|---|
| `base` | `conta.priority + 1` | Ajuste manual do admin |
| `fator_capacidade` | `1 - (enviadas_hoje / daily_limit)` | Conta quase no limite raramente é sorteada |
| `fator_saude` | taxa de `DELIVERED` nas últimas 50 msgs (mín. 0.1) | Conta com entrega ruim é evitada |
| `fator_descanso` | `min(1, segundos_desde_ultimo_envio / 300)` | Distribui no tempo, evita rajadas |
| `fator_warmup` | `0.3` se em warmup, senão `1.0` | Conta nova recebe pouco tráfego |

**Seleção:** roleta ponderada (weighted random). Somam-se os pesos, sorteia-se um
número aleatório nesse intervalo e escolhe-se a conta correspondente.

### 2.3 `preferredAccountId`

Se informado e a conta estiver elegível, ela é usada. Se não estiver, o sistema
**sorteia normalmente** (não falha). Útil para manter continuidade de conversa com
um contato que já falou com aquele número.

### 2.4 Nenhuma conta elegível

```
Fila tem trabalho, mas nenhuma conta disponível
              │
              ├─ Motivo: todas atingiram o limite
              │    → reagenda o job para o próximo slot horário
              │
              ├─ Motivo: todas desconectadas/banidas
              │    → mantém em QUEUED, alerta CRÍTICO,
              │      tenta a cada 60 s
              │
              └─ Mensagem esperando há > 24h
                   → marca FAILED (code: EXPIRED_IN_QUEUE),
                     webhook de falha ao projeto
```

---

## 3. Taxonomia de erros — o coração do fallback

> **Regra de ouro que você definiu:** *só faz sentido tentar outra conta quando o
> problema é da conta. Se o problema é do destinatário, tentar de novo só queima
> reputação de outra conta pelo mesmo motivo.*

### 3.1 Classificação

**Grupo A — Erro do DESTINATÁRIO → falha definitiva, SEM fallback**

| `error_code` | Detecção | Por que não retentar |
|---|---|---|
| `NUMBER_NOT_ON_WHATSAPP` | `onWhatsApp()` retorna vazio | O número não tem WhatsApp. Nenhuma conta vai conseguir |
| `INVALID_NUMBER_FORMAT` | Falha na normalização | Número malformado |
| `BLOCKED_BY_RECIPIENT` | Erro 403 no envio ao contato | O destinatário bloqueou. Outra conta pode até conseguir, mas insistir é abuso |
| `RECIPIENT_PRIVACY_RESTRICTED` | Restrição de privacidade | Configuração do destinatário |

→ Status `FAILED` imediato. Webhook `message.status` com `retryable: false`.

**Grupo B — Erro da CONTA REMETENTE → fallback para outra conta**

| `error_code` | Detecção | Ação |
|---|---|---|
| `ACCOUNT_DISCONNECTED` | Socket fechado durante o envio | Fallback + marca conta |
| `ACCOUNT_BANNED` | 401/403 na sessão | Fallback + marca `BANNED` + alerta |
| `ACCOUNT_RATE_LIMITED` | Rejeição por excesso | Fallback + cooldown na conta |
| `SEND_TIMEOUT` | Sem resposta em 30 s | Fallback |
| `SESSION_ERROR` | Erro de criptografia da sessão | Fallback + investiga conta |

→ Nova tentativa com **conta diferente**, prioridade 1.

**Grupo C — Erro TRANSITÓRIO de infraestrutura → retry na mesma conta**

| `error_code` | Ação |
|---|---|
| `NETWORK_ERROR` | Retry mesma conta, backoff |
| `WHATSAPP_SERVER_ERROR` (5xx) | Retry mesma conta, backoff |
| `INTERNAL_ERROR` | Retry mesma conta, backoff |

### 3.2 Verificação prévia (evita o Grupo A na origem)

**Antes de qualquer envio**, o worker chama `sock.onWhatsApp(numero)`:

```
Número está no cache Redis (TTL 7 dias)?
   ├─ Sim, e é válido    → segue para o envio
   ├─ Sim, e é inválido  → FAILED (NUMBER_NOT_ON_WHATSAPP), sem gastar envio
   └─ Não → consulta o WhatsApp, cacheia o resultado, decide
```

Isso resolve o cenário que você levantou: **um número sem WhatsApp nunca chega a
consumir uma tentativa de envio, muito menos um fallback.**

---

## 4. Fluxo completo de fallback

```
        Job entra no worker
                │
                ▼
    ┌───────────────────────┐
    │ Verifica se o número  │
    │ existe no WhatsApp    │
    └───────────┬───────────┘
                │
        ┌───────┴────────┐
        │ não existe     │ existe
        ▼                ▼
    ┌────────┐   ┌───────────────────┐
    │ FAILED │   │ Sorteia conta     │◄──────────────┐
    │ (sem   │   │ (exclui as já     │               │
    │ retry) │   │  tentadas)        │               │
    └────────┘   └─────────┬─────────┘               │
                           │                          │
                 ┌─────────┴─────────┐                │
                 │ nenhuma           │ conta OK       │
                 ▼                   ▼                │
          ┌─────────────┐   ┌────────────────┐        │
          │ reagenda /  │   │ Aplica delay   │        │
          │ alerta      │   │ humanizado     │        │
          └─────────────┘   └───────┬────────┘        │
                                    ▼                 │
                            ┌───────────────┐         │
                            │ Envia (Baileys)│        │
                            └───────┬───────┘         │
                                    │                 │
                    ┌───────────────┼───────────┐     │
                    ▼               ▼           ▼     │
                 SUCESSO        GRUPO A      GRUPO B/C│
                    │               │           │     │
                    ▼               ▼           ▼     │
              status=SENT      status=FAILED  tentativas
              grava attempt    SEM fallback   < 3?    │
              zera failures    webhook        │       │
              webhook                    ┌────┴────┐  │
                                         │ sim     │ não
                                         └────┬────┘  │
                                              │       ▼
                                              │  status=FAILED
                                              └───────┘ (esgotado)
```

### 4.1 Limites do fallback

| Regra | Valor | Racional |
|---|---|---|
| Máximo de tentativas | **3** | Além disso, provavelmente não é problema de conta |
| Contas distintas | **Sim** | Cada tentativa usa conta ainda não tentada |
| Delay entre tentativas | 10 s, 30 s | Não emenda tentativas — parece robô |
| Se acabarem as contas | Falha com `NO_ACCOUNTS_AVAILABLE` | |

Toda tentativa é registrada em `message_attempts`, permitindo auditar no painel
por quais contas a mensagem passou e por quê.

---

## 5. Delays humanizados

Aplicados **antes de cada envio**, dentro do worker.

| Componente | Valor | Razão |
|---|---|---|
| Base entre envios da mesma conta | 8 a 25 s (aleatório) | Ritmo humano de digitação/envio |
| Jitter adicional | ± 30% do valor base | Elimina periodicidade detectável |
| Simulação de digitação | `presence: composing` por `len/12` segundos (máx 8 s) | Reproduz o comportamento do app real |
| Pausa longa ocasional | 5% de chance de 60-180 s | Humanos param para tomar café |
| Janela de silêncio | 23h–06h **hora local do tenant** (`TENANT_TIMEZONE`, doc 09 §4): só mensagens urgentes | Envio de madrugada é sinal forte de bot |

```ts
function calcularDelay(conta: Account, texto: string): number {
  const base   = randomInt(8_000, 25_000);
  const jitter = base * (Math.random() * 0.6 - 0.3);   // ±30%
  const pausa  = Math.random() < 0.05
    ? randomInt(60_000, 180_000)
    : 0;
  return Math.round(base + jitter + pausa);
}
```

> **A digitação (`composing`) importa mais do que parece.** O app real sempre emite
> presença antes de enviar. Uma mensagem que aparece sem qualquer presença anterior
> é um sinal claro de cliente automatizado.

---

## 6. Idempotência

```
Chegou POST /v1/messages com externalId
              │
              ▼
   Já existe (project_id, external_id)?
              │
    ┌─────────┴─────────┐
    │ sim               │ não
    ▼                   ▼
Retorna 200 com    Cria, enfileira,
a mensagem         retorna 202
existente
```

Garantido pelo índice único parcial em `messages (project_id, external_id)`.
A condição de corrida entre duas requisições simultâneas é resolvida pelo banco:
o segundo INSERT viola a constraint e o handler responde com o registro existente.

---

## 7. Ordem de entrega

**O sistema não garante ordem.** Mensagens são distribuídas entre contas e sofrem
delays aleatórios; duas mensagens enviadas em sequência podem chegar fora de ordem.

Se um projeto precisar de ordem garantida para o mesmo destinatário, a alternativa
é enviar a segunda mensagem apenas após o webhook `delivered` da primeira. Ordenação
nativa por destinatário fica registrada como possível evolução (Fase 3).

---

## 8. Resumo das regras de decisão

| Situação | Fallback? | Status final |
|---|---|---|
| Número não tem WhatsApp | ❌ Não | `FAILED` |
| Número inválido | ❌ Não | `FAILED` |
| Destinatário bloqueou o remetente | ❌ Não | `FAILED` |
| Conta desconectou durante o envio | ✅ Sim | Retry em outra conta |
| Conta foi banida | ✅ Sim | Retry em outra conta + alerta |
| Timeout no envio | ✅ Sim | Retry em outra conta |
| Erro de rede | 🔄 Retry na mesma conta | Até 3× |
| Nenhuma conta disponível | ⏸ Aguarda na fila | `FAILED` após 24h |
| Destinatário pediu opt-out | ❌ Não | `FAILED` (`RECIPIENT_OPTED_OUT`) |

---

## 9. Envio de mídia (imagem/PDF)

`POST /v1/messages/media` (doc 03 §3.3) aceita upload multipart direto na API.
`apps/api` e `apps/worker` **não compartilham filesystem** (só `worker` tem
volume Docker) — a única infra compartilhada entre os dois é o Postgres e o
Redis do tenant, então os bytes do arquivo viajam pelo mesmo canal que já
cruza API→worker hoje: o payload do job na fila `outbound` (`OutboundJobData.media`,
base64). Zero mudança de env/volume/compose.

O job tem vida curta (segundos a minutos; pior caso as 24h de
`MAX_QUEUE_WAIT_MS` do §2.4) e o Redis aceita bulk strings bem maiores que o
teto de 16MB de arquivo (~21,3MB em base64) sem qualquer ajuste de config.
`removeOnComplete`/`removeOnFail` (§1) limpam o job — e os bytes junto — depois
do envio. Só metadata leve (`mediaMimeType`, `mediaFileName`) persiste em
`messages`; os bytes nunca tocam o Postgres.

No worker, `sendMediaCore` (`apps/worker/src/sessions/send.ts`) monta o payload
do Baileys por tipo: `{ image, caption, mimetype }` para imagem, `{ document,
mimetype, fileName, caption }` para PDF. O resto do fluxo — sorteio de conta,
lock, janela de silêncio, ack, taxonomia de erro — é o mesmo de texto.

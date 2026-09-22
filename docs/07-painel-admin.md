# 07 — Painel Administrativo

**URL:** `https://<seu-dominio>` (via `PANEL_PUBLIC_URL`) · **Acesso:** multi-usuário — e-mail + senha + 2FA ·
**Idiomas:** pt / es / en (doc 12)

---

## 1. Mapa de telas

```
/login                         Login: e-mail + senha + TOTP
/login/forgot                  Esqueci a senha (envia link)
/login/reset/{token}           Define nova senha a partir do link
/login/setup                   Primeiro acesso / convite (?token=…): senha + 2FA
/                              Dashboard
/accounts                      Lista de contas WhatsApp
/accounts/new                  Adicionar conta (QR)
/accounts/{id}                 Detalhe da conta
/messages                      Explorador de mensagens
/messages/{id}                 Detalhe + timeline de tentativas
/projects                      Lista de projetos
/projects/{id}                 Detalhe, tokens, webhook
/queue                         Estado da fila
/alerts                        Histórico de alertas
/users                         Usuários do painel (convidar, desativar, remover)
/settings                      Configurações globais
```

### 1.1 Usuários (`/users`)

- **Minha conta** — trocar a própria senha (exige a senha atual).
- **Lista** — e-mail, nome, 2FA, status (Ativo / Desativado / Convite pendente),
  último login. Ações por linha: reenviar convite, desativar/reativar, remover.
  A própria linha não tem ações (não dá para se auto-desativar/remover, nem
  remover o último usuário ativo).
- **Convidar usuário** — cria a conta e envia um link de convite por e-mail
  (72 h) onde a pessoa define senha + 2FA. Requer SMTP configurado.

**Recuperação de acesso sem e-mail** (break-glass, na EC2):
`scripts/admin-create.sh <tenant> <email>` cria o primeiro usuário;
`scripts/admin-reset.sh <tenant> [--email <addr>]` reseta um usuário. Ambos
imprimem o link `/login/setup?token=…`.

### 1.2 Idioma

Cada usuário tem um idioma próprio (pt/es/en), com seletor na sidebar e nas telas
de login. Convidados herdam o idioma de quem convidou; e-mails de convite e
recuperação saem no idioma do destinatário certo (ver doc 12).

---

## 2. Dashboard (`/`)

### 2.1 Cards de topo

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ POOL         │ ENVIADAS HOJE│ TAXA ENTREGA │ FILA         │
│  4 / 5       │    847       │    94.2%     │   12         │
│ ●●●●○        │  ↑ 12% ontem │  ↓ 1.3pp     │  ~45s espera │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

O card **POOL** é o mais importante da tela: muda de cor conforme a saúde
(verde ≥4 · amarelo 2-3 · vermelho ≤1) e é clicável para `/accounts`.

### 2.2 Componentes

| Componente | Conteúdo |
|---|---|
| **Volume no tempo** | Linha: enviadas / entregues / falhas por hora (24h) ou dia (30d) |
| **Distribuição por conta** | Barras horizontais: quantas cada conta enviou + % do limite consumido |
| **Consumo por projeto** | Rosca: participação de cada projeto no volume |
| **Falhas por motivo** | Barras: `error_code` ordenado por frequência. Clicável → filtra `/messages` |
| **Funil** | Enviadas → Entregues → Lidas → Respondidas, com % entre etapas |
| **Alertas recentes** | Últimos 5 eventos críticos com link para ação |
| **Últimas respostas** | Feed do inbound recente (habilita "ver estatística de respostas") |

**Filtro global de período:** Hoje · 7d · 30d · personalizado. Afeta todos os
componentes simultaneamente.

> Cada número no dashboard é **clicável** e leva à listagem filtrada correspondente.
> "847 enviadas hoje" → `/messages?status=sent&from=hoje`. Isso atende ao requisito
> de ver o detalhe por trás de cada estatística.

---

## 3. Contas (`/accounts`)

### 3.1 Lista

| Status | Label | Número | Hoje | Hora | Entrega | Última atividade | Ações |
|---|---|---|---|---|---|---|---|
| 🟢 | Atendimento 1 | +5511999… | 187/300 | 12/40 | 96% | há 2 min | ⏸ 🔄 ⚙ |
| 🟢 | Atendimento 2 | +5511988… | 203/300 | 18/40 | 94% | há 1 min | ⏸ 🔄 ⚙ |
| 🟡 | Atendimento 3 (warmup) | +5511977… | 34/70 | 6/12 | 98% | há 5 min | ⏸ 🔄 ⚙ |
| ⏸ | Reserva | +5511966… | — | — | — | pausada | ▶ ⚙ |
| 🔴 | Atendimento 4 | +5511955… | — | — | — | banida 14:32 | 🗑 |

### 3.2 Detalhe da conta

- **Cabeçalho:** status, número, foto de perfil, conectada desde, dias de warmup
- **Uso:** barras de progresso dos limites horário e diário
- **Gráfico:** envios e taxa de entrega dos últimos 30 dias
- **Timeline:** `account_events` — conexões, quedas, reconexões, alertas
- **Mensagens:** últimas enviadas por esta conta
- **Configuração:** limites, prioridade, ativar/pausar
- **Zona de perigo:** regerar QR · remover conta

### 3.3 Adicionar conta

Wizard de 3 passos: **Nome** → **QR (via SSE, atualiza sozinho)** → **Confirmação**
com aviso do warmup de 7 dias.

---

## 4. Mensagens (`/messages`)

**Filtros:** período · status · direção · projeto · conta · `error_code` ·
busca por número ou `externalId`

### 4.1 Detalhe da mensagem

O elemento central é a **timeline de tentativas**, que responde "por que essa
mensagem demorou / falhou":

```
Mensagem 01J8X4K2M9P7Q3R5T6V8W0Y2Z4          Status: DELIVERED

Para: +5511999998888          Projeto: CRM Clínica
Texto: "Olá! Sua consulta está confirmada para amanhã às 14h."
externalId: consulta-4711-confirmacao

TIMELINE
├─ 14:32:05  Criada          via token "Produção"
├─ 14:32:05  Enfileirada
├─ 14:32:14  Tentativa 1     Conta "Atendimento 2"
│            └─ ❌ FALHOU    ACCOUNT_DISCONNECTED (1.240 ms)
├─ 14:32:24  Tentativa 2     Conta "Atendimento 1"   ← fallback
│            └─ ✅ ENVIADA   (890 ms)
├─ 14:32:29  Entregue
└─ 14:35:02  Lida
```

---

## 5. Projetos (`/projects`)

### 5.1 Detalhe

- **Estatísticas:** volume, taxa de entrega, consumo de quota
- **Tokens:** lista com prefixo, último uso, expiração, botão revogar
- **Webhook:** URL, secret (mascarado), eventos, **botão "Testar"**, log das últimas
  20 entregas com status e possibilidade de reenvio manual
- **Limites:** rate limit por minuto, quota diária
- **Kill switch:** desativar o projeto inteiro

### 5.2 Criar token

O token completo é exibido **uma única vez**, com aviso explícito. Depois, só o prefixo.

---

## 6. Fila (`/queue`)

- Contadores: aguardando · processando · atrasadas · falhas · concluídas hoje
- Lista de jobs pendentes com tempo de espera e conta prevista
- Ações: reprocessar falhas · pausar fila · limpar concluídos
- Alerta visual se a profundidade passar de 500

---

## 7. Configurações (`/settings`)

| Seção | Conteúdo |
|---|---|
| **Alertas** | Número do WhatsApp do admin · e-mail de fallback · quais eventos alertam |
| **Limites padrão** | Valores aplicados a novas contas |
| **Anti-ban** | Delays mín/máx · janela de silêncio · duração do warmup |
| **Retenção** | Dias de retenção (default 90) |
| **Segurança** | Trocar senha · reconfigurar 2FA · sessões ativas |

---

## 8. Requisitos de UX

1. **Realtime onde importa** — status das contas e fila atualizam via SSE a cada 5 s.
   O resto é sob demanda.
2. **Tudo clicável** — nenhum número é um beco sem saída; sempre leva ao detalhe.
3. **Mobile-first nos alertas** — o alerta chega no WhatsApp e o link abre no celular.
   As telas `/accounts` e `/accounts/{id}` **precisam** funcionar bem em tela pequena.
4. **Confirmação dupla** em ações destrutivas (remover conta, revogar token) —
   digitar o nome do recurso para confirmar.
5. **Estados vazios úteis** — sem contas, a tela ensina a adicionar a primeira.

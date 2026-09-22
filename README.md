# wpp-gateway

Gateway de mensageria WhatsApp multi-conta: uma API HTTP única para os sistemas
de uma organização enviarem e receberem mensagens, com pool de contas,
fila assíncrona, fallback automático e painel administrativo.

White-label por design — o código não referencia marca alguma. Cada deploy é uma
instância independente configurada por variáveis de ambiente.

> ⚠️ **Uso responsável.** Este projeto é para mensagens **transacionais
> solicitadas pelo destinatário** — alertas, confirmações, OTP, avisos de status.
> Não é ferramenta de marketing em massa e não deve ser usada para isso. Ver
> [Ética e limites de uso](#ética-e-limites-de-uso).

---

## O problema

Uma organização com vários sistemas (CRM, e-commerce, agendamento, ERP) acaba
integrando WhatsApp N vezes — N implementações, N pontos de falha, N lugares
para descobrir que as mensagens pararam de sair.

Pior: automação de WhatsApp via WhatsApp Web depende de contas reais que **podem
ser banidas a qualquer momento**. Uma integração ingênua descobre isso quando o
cliente reclama que nunca recebeu a confirmação.

## A solução

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Sistema A│  │ Sistema B│  │ Sistema C│
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │ token A     │ token B     │ token C
     └─────────────┼─────────────┘
                   ▼
       ┌───────────────────────┐
       │   API HTTP (Fastify)  │  valida, autentica, enfileira
       └───────────┬───────────┘
                   ▼
       ┌───────────────────────┐
       │   Fila (BullMQ/Redis) │  retry, backoff, prioridade
       └───────────┬───────────┘
                   ▼
       ┌───────────────────────┐
       │  Worker (Baileys)     │  sorteio de conta + anti-ban
       └───────────┬───────────┘
      ┌────────┬───┴────┬────────┐
      ▼        ▼        ▼        ▼
   Conta 1  Conta 2  Conta 3  Conta N   ← pool de contas WhatsApp
      └────────┴────────┴────────┘
                   ▼
            Destinatários
```

O envio é **assíncrono por decisão de arquitetura**: o HTTP responde assim que a
mensagem entra na fila. Isso desacopla a latência (e a instabilidade) do
WhatsApp Web do tempo de resposta dos sistemas que consomem a API, e permite
retry com fallback para outra conta sem que o chamador saiba.

---

## Destaques técnicos

**Resiliência como requisito, não como feature.** A premissa do projeto é que
contas *vão* cair. O que importa é o que acontece depois:

- **Fallback entre contas** — falha de envio reenfileira com prioridade e conta
  diferente, em vez de descartar a mensagem
- **Classificação de desconexão** — distinguir ban real (401/403) de erro de
  stream transitório evita marcar como banida uma conta que só precisa
  reconectar. Essa diferença custou depuração para descobrir
- **Detecção ativa + alerta** — falha silenciosa é o pior cenário; contas
  offline geram alerta por WhatsApp e e-mail

**Anti-ban conservador**, derivado de como a automação é detectada:
warmup obrigatório de 7 dias para contas novas, delay com jitter de ±30%,
indicador de digitação antes de cada envio, janela de silêncio 23h–06h,
limites por hora/dia e verificação prévia de número existente.
([documentado em `docs/06-anti-ban.md`](docs/06-anti-ban.md))

**Multi-tenant em produção.** Uma EC2 (t4g.medium ARM + Docker Compose) roda N
deploys totalmente isolados — volumes, rede, namespace no SSM e banco separados
por tenant — com um Caddy na frente roteando por domínio e TLS automático.
Deploy via GitHub Actions + SSM aplica a mesma imagem a todos os tenants.

**Timezone por tenant.** Janela de silêncio, limite diário e o "hoje" do
dashboard respeitam o fuso do tenant, não o do servidor — um deploy na Colômbia
e outro no Brasil não compartilham a mesma meia-noite.

**Testes que não podem disparar envio real.** Três camadas independentes: fila
com sufixo `-test`, guard no worker e mock do enfileiramento. Um teste que
mande mensagem para um número real é um incidente, não um teste que falhou.

---

## Stack

| Camada | Escolha |
|---|---|
| Linguagem | TypeScript (Node 22, ESM) |
| Monorepo | pnpm workspaces + Turborepo |
| API | Fastify 5 + Zod |
| Fila | BullMQ + Redis 7 |
| WhatsApp | Baileys 6.7 (WhatsApp Web, não-oficial) |
| Banco | PostgreSQL 16 + Prisma 6 |
| Painel | Next.js 15 + React 19 + Tailwind |
| Auth do painel | Argon2 + TOTP (2FA) |
| Observabilidade | Pino + CloudWatch |
| Infra | AWS EC2 ARM, Docker Compose, Caddy, S3 |
| Testes | Vitest (29 suítes) |

~15 mil linhas de TypeScript entre `apps/` e `packages/`.

---

## API

Autenticação por token de projeto (`Authorization: Bearer <token>`), o que
permite rastrear consumo e aplicar cota por sistema consumidor.

```http
POST /v1/messages          envia uma mensagem
POST /v1/messages/bulk     envia em lote
POST /v1/messages/media    envia imagem ou PDF
GET  /v1/messages          consulta status e histórico
POST /v1/webhook/test      testa o webhook de callback
GET  /v1/health            healthcheck (sem auth)
```

Rate limiting por projeto, resolvido em Redis a partir do token autenticado —
cada sistema consumidor tem seu próprio limite.

```bash
curl -X POST https://seu-dominio/v1/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"5511999998888","text":"Seu pedido #123 saiu para entrega."}'
```

Respostas dos destinatários são capturadas e entregues por webhook, permitindo
fluxos bidirecionais. Documentação completa em
[`docs/03-api-publica.md`](docs/03-api-publica.md) e numa página pública em
`/docs/api`.

---

## Painel administrativo

Next.js com i18n em português, inglês e espanhol:

- Pareamento de contas por QR code e acompanhamento de status
- Dashboard de consumo por projeto e por conta
- Gestão de tokens, cotas e limites
- Histórico de mensagens e conversas
- Gestão de opt-out
- Login com 2FA obrigatório

---

## Ética e limites de uso

Automação de WhatsApp é território sensível, e vale ser explícito sobre isso.

**Para o que este projeto foi feito:** mensagens transacionais que o
destinatário pediu ou espera — confirmação de pedido, código de verificação,
alerta de sistema, aviso de agendamento.

**Para o que não foi:** disparo em massa para listas compradas, marketing não
solicitado, qualquer coisa que o destinatário não pediu.

Isso não é só uma questão ética — é a restrição técnica que mais define a
arquitetura. O sinal que mais bane contas não é volume, é **denúncia de
usuário**. Nenhum delay aleatório compensa mensagem indesejada: um punhado de
"Bloquear e denunciar" derruba uma conta mais rápido que qualquer heurística.
Por isso o sistema implementa opt-out real (bloqueia reenvio, não só registra),
janela de silêncio e limites conservadores.

**Sobre os Termos de Serviço:** o uso de bibliotecas não-oficiais como a Baileys
viola os ToS do WhatsApp, e a Meta pode banir qualquer conta sem aviso nem
recurso. Para uso comercial em escala, o caminho correto é a
[API oficial do WhatsApp Business](https://business.whatsapp.com/products/business-platform).
Este projeto existe como solução para cenários de baixo volume onde a API
oficial é inviável — e trata o banimento como certeza estatística, não como
risco remoto.

---

## Rodando localmente

Pré-requisitos: Node 22+, pnpm 11+, Docker.

```bash
pnpm install
cp .env.example .env    # gere as chaves: openssl rand -hex 32
pnpm infra:up           # Postgres 16 + Redis 7
pnpm db:deploy          # migrations
pnpm db:seed            # admin + projeto + token de dev
pnpm dev
```

| Comando | O quê |
|---|---|
| `pnpm infra:up` / `infra:down` | sobe/derruba Postgres e Redis |
| `pnpm db:migrate` | cria migration (dev) |
| `pnpm db:studio` | abre o Prisma Studio |
| `pnpm test:all` | roda todos os testes |
| `pnpm build` | build de todos os packages |
| `pnpm lint` / `pnpm format` | lint e formatação |

---

## Estrutura

```
apps/
  api/        API HTTP pública (Fastify)
  worker/     consumidor da fila + sessões WhatsApp (Baileys)
  panel/      painel administrativo (Next.js)
packages/
  config/     env vars validadas com Zod
  database/   schema Prisma + migrations
  queue/      abstração da fila (BullMQ)
  shared/     tipos e utilitários comuns
  email/      envio de e-mail transacional
docker/       compose de dev e produção
scripts/      deploy, backup, administração
docs/         documentação de arquitetura (00 a 12)
```

## Documentação

O projeto foi planejado antes de ser escrito. Os documentos em
[`docs/`](docs/) registram as decisões:

| Doc | Assunto |
|---|---|
| [00](docs/00-visao-geral.md) | visão geral e objetivos |
| [01](docs/01-arquitetura.md) | arquitetura e componentes |
| [02](docs/02-modelo-de-dados.md) | modelo de dados |
| [03](docs/03-api-publica.md) | API pública |
| [04](docs/04-gestao-de-contas.md) | ciclo de vida das contas |
| [05](docs/05-fila-e-fallback.md) | fila, retry e fallback |
| [06](docs/06-anti-ban.md) | estratégia anti-ban |
| [07](docs/07-painel-admin.md) | painel administrativo |
| [08](docs/08-seguranca-lgpd.md) | segurança e LGPD |
| [09](docs/09-infraestrutura.md) | infraestrutura e deploy |
| [10](docs/10-roadmap.md) | roadmap e histórico |
| [11](docs/11-custos-aws.md) | custos de infraestrutura |
| [12](docs/12-i18n.md) | internacionalização |

---

## Licença

MIT — ver [LICENSE](LICENSE).

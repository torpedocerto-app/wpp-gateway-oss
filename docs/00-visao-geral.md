# 00 — Visão Geral do Projeto

**Projeto:** wpp-gateway
**Tipo:** Gateway de mensageria WhatsApp multi-conta com painel administrativo
**Status:** Fases 0-7 concluídas (1º deploy em prod no ar: wpp.acme-example.com); próxima: conectar contas + warmup / Fase 8
**Última atualização:** 2026-09-08

> **White-label.** Este código não referencia nenhuma marca. Cada deploy é uma
> instância independente (própria conta AWS, próprio EC2, próprio pool de contas
> WhatsApp), configurada por variáveis de ambiente:
> - `PANEL_PUBLIC_URL` — o domínio daquele deploy (ex.: `https://wpp.<cliente>.com`)
> - `PANEL_BRAND_NAME` — o nome exibido no painel
>
> Cada deploy vai para uma conta AWS distinta e um domínio distinto do cliente.

---

## 1. O que é

Um serviço que centraliza o envio e recebimento de mensagens WhatsApp para os
sistemas de **uma organização** (a "holding" que opera aquele deploy).

Em vez de cada sistema (clínica, e-commerce, CRM…) integrar WhatsApp por conta própria,
todos consomem **uma única API** deste gateway. O gateway mantém um **pool de contas
WhatsApp reais** conectadas via WhatsApp Web (protocolo não-oficial) e distribui
os envios entre elas de forma aleatória e humanizada.

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  Projeto A  │   │  Projeto B  │   │  Projeto C  │
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │ token A         │ token B         │ token C
       └─────────────────┼─────────────────┘
                         ▼
              ┌────────────────────────┐
              │      wpp-gateway        │
              │   (este projeto)       │
              └───────────┬────────────┘
                          │ sorteio aleatório
        ┌─────────┬───────┼───────┬─────────┐
        ▼         ▼       ▼       ▼         ▼
     Conta 1   Conta 2  Conta 3  Conta 4  Conta 5
     (+55…)    (+55…)   (+55…)   (+55…)   (+55…)
        └─────────┴───────┴───────┴─────────┘
                          ▼
                  Destinatários finais
```

---

## 2. Objetivos

| # | Objetivo | Por quê |
|---|---|---|
| O1 | Centralizar o envio WhatsApp de toda a holding em um só ponto | Evitar N integrações duplicadas e N pontos de falha |
| O2 | Distribuir carga entre múltiplas contas de forma imprevisível | Reduzir risco de banimento por detecção de padrão |
| O3 | Detectar automaticamente contas banidas/desconectadas e alertar | Falha silenciosa é o pior cenário — mensagens somem sem ninguém saber |
| O4 | Fazer fallback inteligente entre contas | Uma conta cair não pode significar mensagem perdida |
| O5 | Rastrear consumo por projeto | Saber quem usa quanto, cobrar/limitar internamente, debugar |
| O6 | Capturar respostas dos destinatários | Métrica de engajamento + permitir fluxos bidirecionais nos projetos |

---

## 3. Decisões arquiteturais fechadas

Estas decisões foram tomadas na fase de descoberta e são a base de todo o resto
da documentação. Alterar qualquer uma delas exige revisar os documentos seguintes.

| Decisão | Escolha | Racional |
|---|---|---|
| **Stack** | Node.js + TypeScript (monorepo) | A única biblioteca madura de WhatsApp não-oficial (Baileys) é Node. Um runtime só = menos peças móveis. |
| **Biblioteca WhatsApp** | Baileys (`@whiskeysockets/baileys`) | WebSocket puro, sem Chrome/Puppeteer. ~50 MB RAM por sessão vs ~400 MB do Puppeteer. Permite 5+ contas numa t4g.medium (4 GB). |
| **Modelo de envio** | Fila assíncrona (sempre) | API responde `202 Accepted` imediatamente. Só assim é possível aplicar delays anti-ban e fallback sem travar o cliente. |
| **Inbound** | Sim, com webhook por projeto | Habilita a métrica de resposta e fluxos bidirecionais. Conversa bidirecional é também o maior sinal positivo anti-ban. |
| **Infra** | AWS EC2 `t4g.medium` + Docker Compose | Sessões precisam de filesystem persistente e instância única. Fargate foi descartado: rescheduling reconectaria as sessões e custa mais rodando 24/7. |
| **Banco** | PostgreSQL em container na EC2 | O RDS MySQL existente foi descartado — o modelo de dados depende de particionamento, índice único parcial e JSONB. |
| **IP** | Elastic IP fixo | IP variável faria as contas conectarem de endereços diferentes, disparando verificação de segurança do WhatsApp. |
| **Perfil de uso** | Transacional, baixo volume | Confirmações, lembretes, notificações. Limites conservadores, sem necessidade de warmup agressivo. |
| **Tipos de mensagem (MVP)** | Apenas texto | Mídia e botões ficam para fases posteriores. Botões em libs não-oficiais são instáveis. |
| **Autenticação do painel** | Admin único + 2FA | Sem RBAC no MVP. Evolutivo. |
| **Pool de contas** | Único e compartilhado | Todas as contas atendem todos os projetos. Sorteio aleatório entre as saudáveis. |
| **Canal de alerta** | WhatsApp (via conta saudável do pool) + fallback e-mail | Alerta chega no celular. Fallback obrigatório para o caso do pool inteiro cair. |
| **Retenção** | 90 dias detalhado → depois agregado diário | Banco enxuto, exposição LGPD reduzida, estatística histórica preservada. |

---

## 4. Fora de escopo (MVP)

Registrado explicitamente para evitar scope creep durante a implementação:

- ❌ Envio de mídia (imagem, PDF, áudio, vídeo) — **Fase 2**
- ❌ Botões e listas interativas — instável em libs não-oficiais, avaliar depois
- ❌ Multi-tenant com login por projeto — **Fase 3**
- ❌ Campanhas de marketing em massa / spintax / warmup automatizado
- ❌ Chatbot, fluxos conversacionais, IA de atendimento
- ❌ Grupos do WhatsApp (criar, administrar, enviar para grupo)
- ❌ Chamadas de voz/vídeo
- ❌ Cobrança/billing entre projetos da holding

---

## 5. Riscos principais

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Banimento de conta pela Meta | **Alta** | Alto | Pool com redundância ≥ 4 contas, rate-limit conservador, delays humanizados, detecção + alerta imediato. Ver `06-anti-ban.md`. |
| Baileys quebra após update do WhatsApp | Média | Alto | Fixar versão exata, testar em staging antes de subir, manter changelog monitorado. |
| Pool inteiro banido simultaneamente | Baixa | **Crítico** | Contas com chips/IPs de origens distintas, cadastradas em datas diferentes. Alerta com fallback e-mail. |
| Vazamento de dados de conversas | Baixa | **Crítico** | Criptografia em repouso das sessões, retenção curta, acesso restrito. Ver `08-seguranca-lgpd.md`. |
| Uso indevido por um projeto (spam) | Média | Alto | Rate-limit por token, auditoria de consumo, kill switch por token. |

⚠️ **Aviso legal:** o uso de bibliotecas não-oficiais viola os Termos de Serviço do
WhatsApp. Contas podem ser banidas sem aviso e sem recurso. Este projeto assume
esse risco conscientemente e o mitiga com redundância — **nunca com a premissa de
que o banimento não vai acontecer.** Ver `08-seguranca-lgpd.md`.

---

## 6. Índice da documentação

| Doc | Conteúdo |
|---|---|
| `00-visao-geral.md` | Este documento — escopo, decisões, riscos |
| `01-arquitetura.md` | Componentes, fluxos, diagramas, stack detalhada |
| `02-modelo-de-dados.md` | Schema do banco, entidades, relacionamentos |
| `03-api-publica.md` | Contrato da API consumida pelos projetos |
| `04-gestao-de-contas.md` | Ciclo de vida das sessões WhatsApp, QR, estados |
| `05-fila-e-fallback.md` | Regras de enfileiramento, retry, fallback, taxonomia de erros |
| `06-anti-ban.md` | Estratégias de humanização e limites operacionais |
| `07-painel-admin.md` | Telas, dashboard, métricas |
| `08-seguranca-lgpd.md` | Autenticação, criptografia, conformidade |
| `09-infraestrutura.md` | AWS: EC2, ECR, S3, deploy via GitHub Actions + SSM, backup |
| `10-roadmap.md` | Fases de implementação, ordem de construção |
| `11-custos-aws.md` | Auditoria de custos, Savings Plans, controle de orçamento |

# 06 — Estratégia Anti-Ban

> ⚠️ **Premissa fundamental:** nenhuma técnica elimina o risco de banimento. O uso de
> bibliotecas não-oficiais viola os Termos de Serviço do WhatsApp e a Meta pode banir
> qualquer conta a qualquer momento, sem aviso e sem recurso. Este documento reduz a
> probabilidade — **a arquitetura de redundância (doc 05) é o que garante continuidade
> quando o banimento acontecer.**

---

## 1. Como a Meta detecta automação

Entender o que é detectado orienta o que evitar:

| Sinal detectado | Como o sistema evita |
|---|---|
| Volume alto em conta nova | Warmup obrigatório de 7 dias |
| Intervalos regulares entre envios | Delay aleatório com jitter de ±30% |
| Mensagens idênticas em massa | Recomendação de variação no conteúdo (§4) |
| Envio sem presença de digitação | `composing` antes de todo envio |
| Atividade 24h sem pausa | Janela de silêncio 23h–06h |
| Só envia, nunca recebe | Inbound habilitado; conversa bidirecional é sinal positivo |
| Muitos bloqueios/denúncias de usuários | Opt-in real e opt-out funcional (§5) |
| Múltiplos dispositivos/IPs na mesma conta | Elastic IP fixo na AWS, uma sessão por conta |
| Geolocalização do IP inconsistente com o DDD | ⚠️ **Risco aceito** — ver §2.4 |
| Envio para números inexistentes | Verificação `onWhatsApp()` prévia com cache |

> **O sinal mais determinante é a denúncia do usuário.** Nenhum delay compensa
> mensagens indesejadas: um punhado de "Bloquear e denunciar" bane uma conta mais
> rápido que qualquer heurística de volume.

---

## 2. Limites operacionais

Perfil transacional, baixo volume — limites conservadores.

### 2.1 Por conta

| Métrica | Conta em warmup | Conta madura |
|---|---|---|
| Mensagens/hora | 10 | 40 |
| Mensagens/dia | 50 | 300 |
| Intervalo mínimo entre envios | 30 s | 8 s |
| Novos contatos/dia (nunca contatados) | 10 | 50 |

> **O limite de novos contatos é o mais importante.** Enviar para 300 números que
> nunca te contataram é infinitamente mais arriscado que enviar 300 mensagens para
> 30 contatos com quem já existe conversa.

### 2.2 Cronograma de warmup (7 dias)

| Dia | Limite diário | Limite/hora | Peso no sorteio |
|---|---|---|---|
| 1 | 20 | 5 | 0.1 |
| 2 | 40 | 8 | 0.2 |
| 3 | 70 | 12 | 0.3 |
| 4 | 110 | 18 | 0.5 |
| 5 | 160 | 25 | 0.7 |
| 6 | 220 | 32 | 0.85 |
| 7 | 300 | 40 | 1.0 |

Implementado como campo `warmup_until` em `accounts`. Os limites efetivos são
calculados dinamicamente a partir de `connected_at`.

### 2.3 Pool completo

| Métrica | Alvo |
|---|---|
| Contas mínimas em produção | **4** (você pediu 3+; 4 dá margem para uma queda) |
| Conta reserva pausada | 1 |
| Capacidade diária do pool (4 maduras) | ~1.200 mensagens |
| Capacidade segura recomendada | 60% do teto (~720/dia) |

> **Nunca opere no teto.** Se o pool está com 4 contas no limite e uma cai, a carga
> se redistribui e empurra as 3 restantes acima do limite seguro — provocando um
> efeito cascata de banimentos.

### 2.4 Geolocalização do IP — risco aceito

A infraestrutura roda em **`us-east-1` (N. Virginia)**, enquanto as contas usam
números brasileiros (DDD 11 e similares).

**O sinal:** o WhatsApp registra o IP de origem de cada sessão. Uma conta brasileira
que conecta consistentemente de um IP norte-americano de datacenter é uma
inconsistência que pode ser correlacionada — especialmente se várias contas do mesmo
pool compartilham o mesmo IP.

**Por que foi aceito:** custo menor e maior disponibilidade de serviços em us-east-1.
A decisão está registrada em `09-infraestrutura.md` §1.3.

**Plano de contingência:** se a taxa de banimento se mostrar alta nos primeiros
60 dias, migrar para `sa-east-1` (São Paulo) por ~US$4-5/mês a mais. A migração é
simples: snapshot AMI → relaunch na nova região → reassociar Elastic IP novo.

> ⚠️ **Atenção na migração:** o Elastic IP muda de endereço ao trocar de região.
> Todas as contas passarão a conectar de um IP novo de uma vez — o que é, em si,
> um evento de risco. Se for migrar, faça **uma conta por vez**, com alguns dias
> de intervalo, e não durante um pico de volume.

**Monitorar como indicador:** se contas forem banidas nos primeiros dias de uso,
com baixo volume e sem denúncias de usuários, o IP é o suspeito principal.

---

## 3. Boas práticas dos números

**Ao adquirir chips:**
- Chips de operadoras diferentes (Vivo, Claro, TIM, Oi)
- Comprados em momentos diferentes, não todos no mesmo dia
- ❌ Nunca números sequenciais (`...8001`, `...8002`, `...8003`) — correlação óbvia
- ❌ Nunca números virtuais/VoIP — a Meta detecta e bane preventivamente

**Antes de conectar ao sistema:**
1. Usar o chip em um celular real por **alguns dias**, com uso orgânico
2. Preencher foto de perfil, nome e descrição — contas sem perfil são suspeitas
3. Trocar mensagens reais com alguns contatos conhecidos
4. Só então parear com o gateway

**Após conectar:**
- Manter o chip ativo na operadora (não deixar expirar)
- Deixar o celular ligado com o WhatsApp ocasionalmente aberto

---

## 4. Conteúdo das mensagens

| Prática | Recomendação |
|---|---|
| Identificação | Sempre dizer quem é a empresa na primeira mensagem |
| Personalização | Usar o nome do destinatário |
| Variação | Manter 3-5 variações do mesmo template, sorteadas |
| Links | Evitar encurtadores (bit.ly etc) — associados a spam. Usar domínio próprio |
| Tamanho | Entre 50 e 500 caracteres |
| Emojis | Com moderação, 1-3 por mensagem |
| ❌ Evitar | CAPS LOCK, "URGENTE", "GRÁTIS", "CLIQUE AGORA", excesso de emojis |

> Embora o MVP não implemente variação automática (spintax), os projetos consumidores
> devem enviar textos variados. Fica registrado como possível evolução do gateway.

---

## 5. Consentimento e opt-out

**A defesa mais eficaz contra banimento é não incomodar ninguém.**

| Regra | Implementação |
|---|---|
| Só enviar para quem consentiu | Responsabilidade do projeto consumidor |
| Opt-out sempre disponível | Detectar "PARAR", "SAIR", "DESCADASTRAR" no inbound |
| Respeitar opt-out globalmente | Lista de bloqueio compartilhada por todo o pool |
| Resposta rápida ao inbound | Contato sem resposta tende a bloquear |

**Lista de opt-out (implementado):** quando o inbound contiver uma palavra-chave
de descadastro, o número entra na tabela `suppressed_contacts` — bloqueio real,
tenant-wide (não por conta: quem pede pra parar não sabe, nem deve precisar
saber, qual número do pool está mandando). Toda tentativa de envio para ele
(texto ou mídia, API ou fallback interno do worker) falha com
`RECIPIENT_OPTED_OUT` (Grupo A, `FAIL_PERMANENT` — nunca tenta outra conta),
checado em dois pontos: na API antes de enfileirar (`isSuppressed`), e de novo
no worker antes do sorteio de conta (defesa em profundidade, caso o pedido de
opt-out chegue depois do job já estar na fila). Reativação manual só via
`unsuppressContact` (uso futuro no painel).

---

## 6. Monitoramento de saúde

Métricas acompanhadas no dashboard como indicadores precoces:

| Indicador | Saudável | Atenção | Crítico |
|---|---|---|---|
| Taxa de entrega (`delivered/sent`) | > 90% | 70-90% | < 70% |
| Taxa de leitura (`read/delivered`) | > 40% | 20-40% | < 20% |
| Taxa de resposta | > 5% | 1-5% | < 1% |
| Falhas consecutivas por conta | 0-1 | 2-4 | ≥ 5 |
| Contas ativas no pool | ≥ 4 | 2-3 | ≤ 1 |

**Queda na taxa de entrega é o alerta mais precoce de shadow ban** — costuma
preceder o banimento formal em dias.

---

## 7. Checklist operacional

**Diário** — verificar pool completo · revisar falhas · conferir taxa de entrega

**Semanal** — revisar métricas por conta · verificar warmup de contas novas ·
conferir conta reserva

**Mensal** — avaliar rotação de contas antigas · revisar limites conforme volume real ·
testar procedimento de substituição · verificar restauração de backup

# 11 — Custos AWS e Savings Plans

Procedimento de auditoria do consumo atual da conta e dimensionamento de um
Compute Savings Plan que cubra a infraestrutura existente **e** este projeto.

---

## 1. Como Savings Plans realmente funcionam

**A dúvida mais comum — e o mal-entendido mais caro:**

> ❓ *"Posso ativar Savings Plan só para uma instância?"*
> ✅ **Não, e essa é justamente a vantagem.**

Savings Plan **não é vinculado a uma instância**. É um **compromisso de gasto por
hora** aplicado automaticamente sobre toda a conta AWS.

```
Você se compromete com US$ 0,050/hora por 1 ano
                    │
                    ▼
   A AWS aplica o desconto automaticamente,
   priorizando os recursos com maior taxa de desconto
                    │
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
  EC2 do WhatsApp  EC2 existente  Lambda/Fargate
  US$0,033/h       US$0,015/h     US$0,002/h
      └─────────────┴─────────────┘
         Consumo total: US$0,050/h → 100% coberto
```

**Consequências práticas:**

| Fato | Implicação |
|---|---|
| Cobre a conta inteira, não uma instância | Não é possível (nem necessário) restringir |
| Você escolhe o **valor/hora**, não o recurso | O controle está no quanto comprometer |
| Se você desligar a EC2 do WhatsApp | O desconto **realoca sozinho** para outros recursos |
| Consumo acima do compromisso | Cobrado normalmente em On-Demand |
| Consumo abaixo do compromisso | ⚠️ **Você paga a diferença mesmo sem usar** |
| Compromisso | **Irrevogável** por 1 ou 3 anos |

> 🔑 **A regra de ouro:** comprometa apenas o seu **piso de consumo constante** —
> aquilo que você tem certeza que vai rodar 24/7 pelos próximos 12 meses. O excedente
> variável fica On-Demand. Super-comprometer é o único jeito de perder dinheiro
> com Savings Plan.

---

## 2. Compute vs EC2 Instance Savings Plans

| | **Compute SP** | **EC2 Instance SP** |
|---|---|---|
| Desconto máximo | ~54% | ~62% |
| Cobre EC2 | ✅ qualquer família/tamanho | ⚠️ só a família contratada |
| Cobre Fargate | ✅ | ❌ |
| Cobre Lambda | ✅ | ❌ |
| Muda de região | ✅ livre | ❌ região fixa |
| Muda tipo de instância | ✅ livre | ⚠️ só dentro da família |

**Recomendação para o seu caso: Compute Savings Plan.**

Os 8 pontos percentuais a mais do EC2 Instance SP não compensam travar região e
família, por dois motivos concretos deste projeto:

1. O doc 09 registra a possibilidade de **migrar para `sa-east-1`** se a taxa de
   banimento se mostrar alta. Um EC2 Instance SP em us-east-1 seria desperdiçado.
2. Você já tem outros recursos na conta; o Compute SP cobre RDS-adjacentes,
   Lambda e Fargate que possam surgir.

> ℹ️ **RDS não é coberto por Savings Plans.** Para o RDS MySQL existente, o
> equivalente são as **Reserved Instances de RDS** — analisadas na §5.

---

## 3. Auditoria do consumo atual

Execute **antes** de comprar qualquer coisa. Todos os comandos são somente leitura.

### 3.1 Pré-requisito

O Cost Explorer precisa estar habilitado (uma vez, leva ~24h para popular):

```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -v-7d +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity DAILY --metrics UnblendedCost \
  --region us-east-1 >/dev/null 2>&1 \
  && echo "✅ Cost Explorer ativo" \
  || echo "❌ Habilite em: https://console.aws.amazon.com/cost-management/"
```

> No macOS use `date -v-7d`; no Linux, `date -d '7 days ago'`.

### 3.2 Gasto por serviço (últimos 60 dias)

```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -v-60d +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --query 'ResultsByTime[].Groups[?Metrics.UnblendedCost.Amount>`1`].[Keys[0],Metrics.UnblendedCost.Amount]' \
  --output table
```

Mostra onde o dinheiro está indo hoje. Serviços abaixo de US$1 são filtrados.

### 3.3 Inventário de EC2 em execução

```bash
aws ec2 describe-instances \
  --filters Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].[InstanceId,InstanceType,Placement.AvailabilityZone,Tags[?Key==`Name`]|[0].Value]' \
  --output table
```

### 3.4 Savings Plans já existentes

```bash
aws savingsplans describe-savings-plans \
  --states active \
  --query 'savingsPlans[].[savingsPlanId,savingsPlanType,commitment,end,ec2InstanceFamily]' \
  --output table
```

> ⚠️ **Verifique isto antes de tudo.** Se já existe um SP ativo com cobertura
> sobrando, a EC2 nova pode já entrar coberta — e comprar outro seria
> super-compromisso puro.

### 3.5 Cobertura e utilização atuais

```bash
# Quanto do seu gasto elegível já está coberto por SP
aws ce get-savings-plans-coverage \
  --time-period Start=$(date -v-30d +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --query 'SavingsPlansCoverages[].Coverage.[CoveragePercentage,OnDemandCost,SpendCoveredBySavingsPlans]' \
  --output table

# Se você já tem SP: está usando tudo que comprometeu?
aws ce get-savings-plans-utilization \
  --time-period Start=$(date -v-30d +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --query 'SavingsPlansUtilizationsByTime[].Utilization' --output table
```

**Como ler:**

| Métrica | Significado | Ação |
|---|---|---|
| Coverage baixo (< 50%) | Muito On-Demand descoberto | Espaço para comprar SP |
| Coverage alto (> 90%) | Quase tudo coberto | Não compre mais |
| Utilization < 100% | **Você paga por compromisso não usado** | 🔴 Já está super-comprometido |
| Utilization = 100% | Compromisso todo aproveitado | Saudável |

### 3.6 Recomendação oficial da AWS

```bash
aws ce get-savings-plans-purchase-recommendation \
  --savings-plans-type COMPUTE_SP \
  --term-in-years ONE_YEAR \
  --payment-option NO_UPFRONT \
  --lookback-period-in-days SIXTY_DAYS \
  --query 'SavingsPlansPurchaseRecommendation.{
      CommitmentPorHora: SavingsPlansPurchaseRecommendationSummary.HourlyCommitmentToPurchase,
      EconomiaMensal:    SavingsPlansPurchaseRecommendationSummary.EstimatedMonthlySavingsAmount,
      PercentualEconomia:SavingsPlansPurchaseRecommendationSummary.EstimatedSavingsPercentage,
      GastoOnDemandAtual:SavingsPlansPurchaseRecommendationSummary.CurrentOnDemandSpend,
      UtilizacaoEstimada:SavingsPlansPurchaseRecommendationSummary.EstimatedUtilization
  }' --output table
```

A AWS calcula o valor/hora ideal com base no seu uso **real** dos últimos 60 dias.

> ⚠️ **`EstimatedUtilization` abaixo de 95% é sinal de alerta** — significa que a
> recomendação inclui consumo que a AWS julga instável. Prefira comprometer menos.

### 3.7 Script consolidado

`scripts/aws-cost-audit.sh` — roda tudo de uma vez:

```bash
#!/bin/bash
set -euo pipefail
D60=$(date -v-60d +%Y-%m-%d 2>/dev/null || date -d '60 days ago' +%Y-%m-%d)
HOJE=$(date +%Y-%m-%d)

echo "═══ 1. GASTO POR SERVIÇO (60d) ═══"
aws ce get-cost-and-usage --time-period Start=$D60,End=$HOJE \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --query 'ResultsByTime[-1].Groups[?Metrics.UnblendedCost.Amount>`1`].[Keys[0],Metrics.UnblendedCost.Amount]' \
  --output table

echo "═══ 2. EC2 EM EXECUÇÃO ═══"
aws ec2 describe-instances --filters Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].[InstanceId,InstanceType,Tags[?Key==`Name`]|[0].Value]' \
  --output table

echo "═══ 3. SAVINGS PLANS ATIVOS ═══"
aws savingsplans describe-savings-plans --states active \
  --query 'savingsPlans[].[savingsPlanId,savingsPlanType,commitment,end]' --output table

echo "═══ 4. RECOMENDAÇÃO COMPUTE SP (1 ano, no upfront) ═══"
aws ce get-savings-plans-purchase-recommendation \
  --savings-plans-type COMPUTE_SP --term-in-years ONE_YEAR \
  --payment-option NO_UPFRONT --lookback-period-in-days SIXTY_DAYS \
  --query 'SavingsPlansPurchaseRecommendation.SavingsPlansPurchaseRecommendationSummary.[
      HourlyCommitmentToPurchase,EstimatedMonthlySavingsAmount,
      EstimatedSavingsPercentage,EstimatedUtilization]' --output table

echo "═══ 5. RDS EM EXECUÇÃO (Reserved Instance, não SP) ═══"
aws rds describe-db-instances \
  --query 'DBInstances[?DBInstanceStatus==`available`].[DBInstanceIdentifier,DBInstanceClass,Engine,MultiAZ]' \
  --output table
```

---

## 4. Estratégia de compra recomendada

### Etapa 1 — Auditar (agora, antes de tudo)

```bash
./scripts/aws-cost-audit.sh > /tmp/audit-inicial.txt
```

Registre o **baseline**: quanto você gasta hoje e quanto já está coberto.

### Etapa 2 — Subir a infraestrutura On-Demand

Provisione conforme o doc 09. Rode **sem nenhum Savings Plan novo** por 30-60 dias.

> **Por que esperar:** o Cost Explorer precisa de histórico real para recomendar bem.
> Comprar SP baseado em estimativa teórica é a forma mais comum de super-comprometer.
> Neste projeto há um motivo adicional: você ainda não sabe se as contas WhatsApp
> vão sobreviver. Se o modelo se mostrar inviável em 2 meses, um compromisso de
> 1 ano vira custo afundado.

### Etapa 3 — Reavaliar após 60 dias

```bash
./scripts/aws-cost-audit.sh > /tmp/audit-60d.txt
diff /tmp/audit-inicial.txt /tmp/audit-60d.txt
```

Decida com base em três perguntas:

| Pergunta | Se sim | Se não |
|---|---|---|
| O projeto se sustentou (contas vivas, volume real)? | Prossiga | Não compre |
| `EstimatedUtilization` ≥ 95%? | Prossiga | Comprometa menos |
| Você pretende manter a conta AWS por 12+ meses? | Prossiga | Fique On-Demand |

### Etapa 4 — Comprar de forma conservadora

**Comprometa 80-90% da recomendação, não 100%.**

```bash
# Exemplo: AWS recomenda US$0,050/h → comprometa US$0,042/h
aws savingsplans create-savings-plan \
  --savings-plan-offering-id <OFFERING_ID> \
  --commitment 0.042 \
  --upfront-payment-amount 0
```

A margem de 10-20% protege contra queda de consumo (uma instância desligada, um
serviço descontinuado). O excedente descoberto sai em On-Demand — o que é bem melhor
que pagar por compromisso ocioso.

Para descobrir o `OFFERING_ID`:

```bash
aws savingsplans describe-savings-plans-offerings \
  --plan-types Compute --durations 31536000 --payment-options "No Upfront" \
  --query 'searchResults[0].offeringId' --output text
```

### Etapa 5 — Monitorar mensalmente

```bash
aws ce get-savings-plans-utilization \
  --time-period Start=$(date -v-30d +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY
```

Utilization < 100% por 2 meses seguidos = você está pagando por compromisso ocioso.
Não dá para cancelar, mas serve de lição para a próxima renovação.

---

## 5. RDS MySQL existente

Savings Plans **não cobrem RDS**. Se o RDS roda 24/7 de forma estável:

```bash
# Recomendação de Reserved Instance para RDS
aws ce get-reservation-purchase-recommendation \
  --service "Amazon Relational Database Service" \
  --term-in-years ONE_YEAR --payment-option NO_UPFRONT \
  --lookback-period-in-days SIXTY_DAYS \
  --query 'Recommendations[0].RecommendationSummary' --output table

# Utilização das RIs que você já tem
aws ce get-reservation-utilization \
  --time-period Start=$(date -v-30d +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY --output table
```

RDS Reserved Instances oferecem ~40% de desconto em 1 ano sem entrada. É uma
análise independente deste projeto, mas vale fazer na mesma rodada.

---

## 6. Controle de custos

### 6.1 Budget com alerta

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

cat > /tmp/budget.json <<'EOF'
{
  "BudgetName": "wpp-gateway-mensal",
  "BudgetLimit": { "Amount": "50", "Unit": "USD" },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST",
  "CostFilters": { "TagKeyValue": ["user:Project$wpp"] }
}
EOF

cat > /tmp/notifications.json <<'EOF'
[{
  "Notification": {
    "NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN",
    "Threshold": 80, "ThresholdType": "PERCENTAGE"
  },
  "Subscribers": [{ "SubscriptionType": "EMAIL",
                    "Address": "admin@example.com" }]
}]
EOF

aws budgets create-budget --account-id $ACCOUNT \
  --budget file:///tmp/budget.json \
  --notifications-with-subscribers file:///tmp/notifications.json
```

Alerta em 80% e 100% do orçamento de US$50/mês.

### 6.2 Tags obrigatórias

Todo recurso deste projeto recebe `Project=wpp`. Sem isso, o filtro de custo do
budget não funciona e você não consegue separar o gasto deste projeto do resto
da holding.

```bash
aws ec2 create-tags --resources $INSTANCE_ID $VOLUME_ID $ALLOC_ID \
  --tags Key=Project,Value=wpp Key=Environment,Value=production
```

> Ative **Cost Allocation Tags** no console de Billing (uma vez) para que a tag
> `Project` fique disponível como filtro no Cost Explorer.

---

## 7. Resumo executivo

| Decisão | Escolha |
|---|---|
| Savings Plan por instância? | ❌ Impossível — cobre a conta inteira, por valor/hora |
| Tipo recomendado | **Compute SP**, 1 ano, No Upfront |
| Quando comprar | Após **60 dias** de operação real |
| Quanto comprometer | **80-90%** da recomendação da AWS |
| RDS | Analisar **Reserved Instance** separadamente |
| Economia esperada na EC2 | ~37% (US$24,53 → US$15,45/mês) |
| Proteção contra erro | Budget com alerta + tags de alocação |

**Custo do projeto:**
- Primeiros 60 dias (On-Demand): **~US$33/mês** (≈ R$ 180)
- Após Savings Plan: **~US$24/mês** (≈ R$ 130)
- Com os 5 chips: **≈ R$ 230-330/mês**

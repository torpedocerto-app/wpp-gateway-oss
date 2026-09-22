/**
 * Retenção de dados (doc 02 §3) — LGPD art. 15/16: os dados são eliminados
 * quando o tratamento termina.
 *
 * Três responsabilidades, nesta ordem de importância:
 *
 *  1. **Criar partições futuras de `messages`.** Se a partição do mês seguinte
 *     não existir, TODO INSERT em messages falha na virada do mês — ou seja,
 *     o gateway para de aceitar mensagens. Isto roda primeiro e, se falhar,
 *     dispara alerta: é o único passo cuja falha derruba o serviço.
 *  2. **Descartar partições vencidas** (DROP PARTITION, não DELETE: instantâneo
 *     e devolve o espaço em disco de imediato).
 *  3. **Limpar por data** as tabelas não particionadas.
 *
 * A janela de retenção de `messages` vem de RETENTION_DAYS. Como o descarte é
 * por partição mensal, uma partição só cai quando seu mês INTEIRO está fora da
 * janela — na prática as mensagens vivem um pouco mais que o configurado, o que
 * é o lado seguro do arredondamento.
 */
import { loadEnv } from '@wpp/config';
import { prisma } from '@wpp/database';
import { AlertType } from '@wpp/shared';
import { logger } from '../logger.js';
import type { AlertService } from '../alerts/index.js';

const env = loadEnv();

/** Partições criadas à frente do mês corrente (doc 02 §3: 2 meses). */
const MONTHS_AHEAD = 2;
/** Retenção das tabelas não particionadas (doc 02 §3). */
const ACCOUNT_EVENTS_DAYS = 365;
const WEBHOOK_DELIVERIES_DAYS = 30;

export interface RetentionResult {
  partitionsCreated: string[];
  partitionsDropped: string[];
  orphanAttemptsDeleted: number;
  accountEventsDeleted: number;
  webhookDeliveriesDeleted: number;
}

/**
 * Garante que existam partições para o mês corrente e os próximos MONTHS_AHEAD.
 * Idempotente: create_messages_partition() já checa existência.
 */
async function ensureFuturePartitions(): Promise<string[]> {
  const created: string[] = [];

  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    // Nome da partição alvo, calculado pelo Postgres (mesma expressão que a
    // função usa internamente — evita divergência de fuso entre Node e banco).
    const rows = await prisma.$queryRaw<{ part_name: string; existed: boolean }[]>`
      SELECT part_name, EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) AS existed
      FROM (
        SELECT 'messages_' || to_char(
          (date_trunc('month', now()) + make_interval(months => ${i}::int))::date,
          'YYYY_MM'
        ) AS part_name
      ) s
    `;

    const row = rows[0];
    if (!row) throw new Error('retenção: consulta de nome de partição não retornou linha');
    if (row.existed) continue;

    await prisma.$executeRaw`
      SELECT create_messages_partition(
        (date_trunc('month', now()) + make_interval(months => ${i}::int))::date
      )
    `;
    created.push(row.part_name);
    logger.info({ partition: row.part_name }, 'retenção: partição criada');
  }

  return created;
}

/**
 * Descarta partições de `messages` inteiramente fora da janela de retenção.
 * Uma partição cobre [início do mês, início do mês seguinte); só é descartada
 * quando esse limite superior já passou do corte.
 */
async function dropExpiredPartitions(retentionDays: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ part_name: string }[]>`
    SELECT c.relname AS part_name
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'messages'
      AND c.relname ~ '^messages_[0-9]{4}_[0-9]{2}$'
      -- limite superior da partição (1º dia do mês seguinte ao do nome)
      AND (to_date(substring(c.relname from 10), 'YYYY_MM') + INTERVAL '1 month')
          <= (now() - make_interval(days => ${retentionDays}::int))
    ORDER BY c.relname
  `;

  const dropped: string[] = [];
  for (const { part_name } of rows) {
    // part_name vem do catálogo do Postgres e casou com o regex acima, então a
    // interpolação é segura — $queryRaw não parametriza identificadores.
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${part_name}"`);
    dropped.push(part_name);
    logger.info({ partition: part_name }, 'retenção: partição descartada');
  }
  return dropped;
}

/** Executa um ciclo completo de retenção. */
export async function runRetention(alerts?: AlertService): Promise<RetentionResult> {
  const retentionDays = env.RETENTION_DAYS;

  // 1. Partições futuras — o passo crítico.
  let partitionsCreated: string[] = [];
  try {
    partitionsCreated = await ensureFuturePartitions();
  } catch (err) {
    logger.error({ err }, 'retenção: FALHA ao criar partições futuras');
    await alerts?.fire(
      AlertType.RETENTION_FAILED,
      'Falha ao criar partições de mensagens',
      'O job de retenção não conseguiu criar as partições futuras de `messages`.\n\n' +
        'Se a partição do próximo mês não existir, TODO envio falha na virada do mês.\n\n' +
        `Erro: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }

  // 2 e 3. Limpeza — falha aqui não interrompe o serviço, só acumula dado.
  const cutoffEvents = new Date(Date.now() - ACCOUNT_EVENTS_DAYS * 86_400_000);
  const cutoffWebhooks = new Date(Date.now() - WEBHOOK_DELIVERIES_DAYS * 86_400_000);

  const partitionsDropped = await dropExpiredPartitions(retentionDays);

  // `message_attempts` NÃO tem FK para `messages` (só para `accounts`), então
  // dropar uma partição deixa as tentativas daquelas mensagens órfãs — elas não
  // saem por cascade, ao contrário do que a doc 02 §3 sugeria. Limpa aqui.
  // Só vale a pena varrer quando algo foi realmente descartado.
  let orphanAttemptsDeleted = 0;
  if (partitionsDropped.length > 0) {
    orphanAttemptsDeleted = await prisma.$executeRaw`
      DELETE FROM message_attempts ma
      WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = ma.message_id)
    `;
  }

  const [accountEvents, webhookDeliveries] = await Promise.all([
    prisma.accountEvent.deleteMany({ where: { createdAt: { lt: cutoffEvents } } }),
    prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: cutoffWebhooks } } }),
  ]);

  const result: RetentionResult = {
    partitionsCreated,
    partitionsDropped,
    orphanAttemptsDeleted,
    accountEventsDeleted: accountEvents.count,
    webhookDeliveriesDeleted: webhookDeliveries.count,
  };

  logger.info({ ...result, retentionDays }, 'retenção: ciclo concluído');
  return result;
}

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, AccountStatus } from '@wpp/database';
import { runRetention } from './service.js';

/** Nome da partição de um mês relativo ao atual. */
function partName(monthOffset: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + monthOffset);
  return `messages_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function partitionExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM pg_class WHERE relname = ${name}
  `;
  return Number(rows[0]!.n) > 0;
}

/** Cria uma partição para um mês arbitrário (inclusive no passado). */
async function createPartitionFor(monthOffset: number): Promise<string> {
  await prisma.$executeRawUnsafe(
    `SELECT create_messages_partition((date_trunc('month', now()) + make_interval(months => ${monthOffset}))::date)`,
  );
  return partName(monthOffset);
}

let acctId: string;

beforeEach(async () => {
  const acct = await prisma.account.create({
    data: {
      label: 'retention-test',
      status: AccountStatus.DISCONNECTED,
      sessionPath: '/tmp/retention-test',
    },
  });
  acctId = acct.id;
});

afterAll(async () => {
  await prisma.account.deleteMany({ where: { label: 'retention-test' } });
});

describe('retenção (doc 02 §3)', () => {
  it('cria as partições do mês atual e dos 2 próximos', async () => {
    // Remove as futuras para provar que o job as recria.
    for (const off of [1, 2]) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partName(off)}"`);
    }
    expect(await partitionExists(partName(1))).toBe(false);

    const r = await runRetention();

    expect(await partitionExists(partName(0))).toBe(true);
    expect(await partitionExists(partName(1))).toBe(true);
    expect(await partitionExists(partName(2))).toBe(true);
    expect(r.partitionsCreated).toContain(partName(1));
    expect(r.partitionsCreated).toContain(partName(2));
  });

  it('é idempotente: rodar de novo não cria nada', async () => {
    await runRetention();
    const r = await runRetention();
    expect(r.partitionsCreated).toEqual([]);
  });

  it('descarta partição inteiramente fora da janela de retenção', async () => {
    // RETENTION_DAYS default = 90 → uma partição de 6 meses atrás está fora.
    const old = await createPartitionFor(-6);
    expect(await partitionExists(old)).toBe(true);

    const r = await runRetention();

    expect(r.partitionsDropped).toContain(old);
    expect(await partitionExists(old)).toBe(false);
  });

  it('NÃO descarta a partição do mês corrente', async () => {
    await runRetention();
    expect(await partitionExists(partName(0))).toBe(true);
  });

  it('NÃO descarta partição parcialmente dentro da janela', async () => {
    // O mês passado contém dias dentro dos últimos 90 → deve sobreviver.
    const recent = await createPartitionFor(-1);
    const r = await runRetention();
    expect(r.partitionsDropped).not.toContain(recent);
    expect(await partitionExists(recent)).toBe(true);
  });

  it('apaga message_attempts órfãs quando uma partição é descartada', async () => {
    // message_attempts não tem FK para messages, então nada sai por cascade:
    // sem esta limpeza, a tentativa sobreviveria à mensagem indefinidamente.
    const old = await createPartitionFor(-6);
    const orphan = await prisma.messageAttempt.create({
      data: {
        messageId: crypto.randomUUID(), // aponta para mensagem inexistente
        accountId: acctId,
        attemptNumber: 1,
        result: 'FAILED',
        durationMs: 10,
      },
    });

    const r = await runRetention();

    expect(r.partitionsDropped).toContain(old);
    expect(r.orphanAttemptsDeleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.messageAttempt.findUnique({ where: { id: orphan.id } })).toBeNull();
  });

  it('não varre órfãs quando nada foi descartado', async () => {
    await runRetention(); // garante estado estável
    const r = await runRetention();
    expect(r.partitionsDropped).toEqual([]);
    expect(r.orphanAttemptsDeleted).toBe(0);
  });

  it('apaga account_events com mais de 1 ano e preserva os recentes', async () => {
    const oldEvent = await prisma.accountEvent.create({
      data: {
        accountId: acctId,
        type: 'CONNECTED',
        createdAt: new Date(Date.now() - 400 * 86_400_000),
      },
    });
    const recentEvent = await prisma.accountEvent.create({
      data: { accountId: acctId, type: 'CONNECTED', createdAt: new Date() },
    });

    await runRetention();

    expect(await prisma.accountEvent.findUnique({ where: { id: oldEvent.id } })).toBeNull();
    expect(await prisma.accountEvent.findUnique({ where: { id: recentEvent.id } })).not.toBeNull();
  });

  it('apaga webhook_deliveries com mais de 30 dias e preserva os recentes', async () => {
    const project = await prisma.project.create({
      data: { name: 'retention-test', slug: `ret-${Date.now()}`, webhookEvents: [] },
    });

    const oldDelivery = await prisma.webhookDelivery.create({
      data: {
        projectId: project.id,
        eventType: 'message.status',
        payload: {},
        createdAt: new Date(Date.now() - 45 * 86_400_000),
      },
    });
    const recentDelivery = await prisma.webhookDelivery.create({
      data: { projectId: project.id, eventType: 'message.status', payload: {} },
    });

    await runRetention();

    expect(
      await prisma.webhookDelivery.findUnique({ where: { id: oldDelivery.id } }),
    ).toBeNull();
    expect(
      await prisma.webhookDelivery.findUnique({ where: { id: recentDelivery.id } }),
    ).not.toBeNull();

    await prisma.project.delete({ where: { id: project.id } });
  });
});

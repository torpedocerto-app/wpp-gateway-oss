import { prisma } from '@wpp/database';
import { startOfLocalDayUtc } from '@wpp/shared';
import { env } from './env';

/** Consultas de estatística para o dashboard (BFF — server-side, sem passar pela API /v1). */

function startOfToday(): Date {
  return startOfLocalDayUtc(new Date(), env.TENANT_TIMEZONE);
}

export async function dashboardStats() {
  const today = startOfToday();

  const [poolActive, poolTotal, sentToday, deliveredToday, failedToday, inboundToday, queueDepth] =
    await Promise.all([
      prisma.account.count({ where: { status: 'CONNECTED', isEnabled: true } }),
      prisma.account.count({ where: { status: { not: 'BANNED' } } }),
      prisma.message.count({
        where: { direction: 'OUTBOUND', createdAt: { gte: today }, status: { in: ['SENT', 'DELIVERED', 'READ'] } },
      }),
      prisma.message.count({
        where: { direction: 'OUTBOUND', createdAt: { gte: today }, status: { in: ['DELIVERED', 'READ'] } },
      }),
      prisma.message.count({
        where: { direction: 'OUTBOUND', createdAt: { gte: today }, status: 'FAILED' },
      }),
      prisma.message.count({ where: { direction: 'INBOUND', createdAt: { gte: today } } }),
      prisma.message.count({ where: { status: { in: ['QUEUED', 'SENDING'] } } }),
    ]);

  const deliveryRate = sentToday > 0 ? deliveredToday / sentToday : null;

  return {
    poolActive,
    poolTotal,
    sentToday,
    deliveredToday,
    failedToday,
    inboundToday,
    queueDepth,
    deliveryRate,
  };
}

/** Falhas de hoje agrupadas por error_code. */
export async function failureBreakdown() {
  const today = startOfToday();
  const rows = await prisma.message.groupBy({
    by: ['errorCode'],
    where: { direction: 'OUTBOUND', createdAt: { gte: today }, status: 'FAILED' },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ code: r.errorCode ?? 'DESCONHECIDO', count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}

/** Volume enviado por conta hoje, com % do limite diário. */
export async function perAccountVolume() {
  const today = startOfToday();
  const accounts = await prisma.account.findMany({
    where: { status: { not: 'BANNED' } },
    select: { id: true, label: true, dailyLimit: true },
  });
  const counts = await prisma.message.groupBy({
    by: ['accountId'],
    where: { direction: 'OUTBOUND', createdAt: { gte: today }, accountId: { not: null } },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((c) => [c.accountId, c._count._all]));
  return accounts
    .map((a) => {
      const sent = byId.get(a.id) ?? 0;
      return { label: a.label, sent, dailyLimit: a.dailyLimit, pct: a.dailyLimit ? sent / a.dailyLimit : 0 };
    })
    .sort((a, b) => b.sent - a.sent);
}

/** Últimas mensagens recebidas (feed de respostas). */
export async function recentInbound(limit = 8) {
  return prisma.message.findMany({
    where: { direction: 'INBOUND' },
    select: { id: true, fromNumber: true, content: true, createdAt: true, projectId: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

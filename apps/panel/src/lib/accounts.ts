import { prisma } from '@wpp/database';
import { startOfLocalDayUtc, startOfLocalHourUtc } from '@wpp/shared';
import { env } from './env';

function startOfToday(): Date {
  return startOfLocalDayUtc(new Date(), env.TENANT_TIMEZONE);
}
function startOfHour(): Date {
  return startOfLocalHourUtc(new Date(), env.TENANT_TIMEZONE);
}

export interface AccountRow {
  id: string;
  label: string;
  phoneNumber: string | null;
  status: string;
  isEnabled: boolean;
  dailyLimit: number;
  hourlyLimit: number;
  sentToday: number;
  sentThisHour: number;
  deliveryRate: number | null;
  lastSeenAt: Date | null;
  inWarmup: boolean;
}

export async function listAccounts(): Promise<AccountRow[]> {
  const today = startOfToday();
  const hour = startOfHour();
  const now = Date.now();

  const accounts = await prisma.account.findMany({ orderBy: { createdAt: 'asc' } });

  const [dayCounts, hourCounts, recentByAccount] = await Promise.all([
    prisma.message.groupBy({
      by: ['accountId'],
      where: { direction: 'OUTBOUND', createdAt: { gte: today }, accountId: { not: null } },
      _count: { _all: true },
    }),
    prisma.message.groupBy({
      by: ['accountId'],
      where: { direction: 'OUTBOUND', createdAt: { gte: hour }, accountId: { not: null } },
      _count: { _all: true },
    }),
    prisma.message.findMany({
      where: {
        direction: 'OUTBOUND',
        accountId: { not: null },
        status: { in: ['SENT', 'DELIVERED', 'READ', 'FAILED'] },
      },
      select: { accountId: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
  ]);

  const dayById = new Map(dayCounts.map((c) => [c.accountId, c._count._all]));
  const hourById = new Map(hourCounts.map((c) => [c.accountId, c._count._all]));

  const rateById = new Map<string, number>();
  const groups = new Map<string, { total: number; delivered: number }>();
  for (const m of recentByAccount) {
    if (!m.accountId) continue;
    const g = groups.get(m.accountId) ?? { total: 0, delivered: 0 };
    g.total++;
    if (m.status === 'DELIVERED' || m.status === 'READ') g.delivered++;
    groups.set(m.accountId, g);
  }
  for (const [id, g] of groups) {
    if (g.total >= 10) rateById.set(id, g.delivered / g.total);
  }

  return accounts.map((a) => ({
    id: a.id,
    label: a.label,
    phoneNumber: a.phoneNumber,
    status: a.status,
    isEnabled: a.isEnabled,
    dailyLimit: a.dailyLimit,
    hourlyLimit: a.hourlyLimit,
    sentToday: dayById.get(a.id) ?? 0,
    sentThisHour: hourById.get(a.id) ?? 0,
    deliveryRate: rateById.get(a.id) ?? null,
    lastSeenAt: a.lastSeenAt,
    inWarmup: a.warmupUntil !== null && a.warmupUntil.getTime() > now,
  }));
}

export async function getAccount(id: string) {
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) return null;
  const events = await prisma.accountEvent.findMany({
    where: { accountId: id },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  const recentMessages = await prisma.message.findMany({
    where: { accountId: id },
    select: { id: true, toNumber: true, status: true, content: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });
  return { account, events, recentMessages };
}

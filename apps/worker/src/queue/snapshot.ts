import type { Redis } from 'ioredis';
import { loadEnv } from '@wpp/config';
import { prisma, MessageStatus } from '@wpp/database';
import { AccountStatus, type AccountSnapshot } from '@wpp/shared';
import type { SessionManager } from '../sessions/index.js';
import { readCounters, readLastSend, isAccountLocked, isInCooldown, isQuarantined } from '../state/index.js';

const env = loadEnv();

/**
 * Monta o snapshot de todas as contas do pool para alimentar `selectAccount`
 * (doc 05 §2). Junta:
 *  - Postgres: status, limites, warmup, taxa de entrega recente
 *  - SessionManager: socket realmente aberto
 *  - Redis: contadores hora/dia, lock, cooldown, quarentena, último envio
 */
export async function buildAccountSnapshots(
  redis: Redis,
  manager: SessionManager,
): Promise<AccountSnapshot[]> {
  const accounts = await prisma.account.findMany({
    where: { status: { not: AccountStatus.BANNED } },
    select: {
      id: true,
      status: true,
      isEnabled: true,
      priority: true,
      dailyLimit: true,
      hourlyLimit: true,
      warmupUntil: true,
    },
  });

  const now = Date.now();

  return Promise.all(
    accounts.map(async (a): Promise<AccountSnapshot> => {
      const [counters, lastSendAt, locked, cooldown, quarantined, deliveryRate] = await Promise.all([
        readCounters(redis, a.id, env.TENANT_TIMEZONE),
        readLastSend(redis, a.id),
        isAccountLocked(redis, a.id),
        isInCooldown(redis, a.id),
        isQuarantined(redis, a.id),
        recentDeliveryRate(a.id),
      ]);

      const session = manager.active.get(a.id);

      return {
        id: a.id,
        status: a.status,
        isEnabled: a.isEnabled,
        socketOpen: session?.isOpen ?? false,
        priority: a.priority,
        dailyLimit: a.dailyLimit,
        hourlyLimit: a.hourlyLimit,
        sentToday: counters.day,
        sentThisHour: counters.hour,
        lastSendAt,
        recentDeliveryRate: deliveryRate,
        inWarmup: a.warmupUntil !== null && a.warmupUntil.getTime() > now,
        quarantined,
        locked,
        inCooldown: cooldown,
      };
    }),
  );
}

/**
 * Taxa de DELIVERED nas últimas ~50 mensagens outbound da conta (doc 05 §2.2).
 * null se a conta ainda não tem histórico suficiente.
 */
async function recentDeliveryRate(accountId: string): Promise<number | null> {
  const recent = await prisma.message.findMany({
    where: { accountId, direction: 'OUTBOUND', status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ, MessageStatus.FAILED] } },
    select: { status: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  if (recent.length < 10) return null;
  const delivered = recent.filter(
    (m) => m.status === MessageStatus.DELIVERED || m.status === MessageStatus.READ,
  ).length;
  return delivered / recent.length;
}

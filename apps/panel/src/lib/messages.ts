import { prisma } from '@wpp/database';

export interface MessageFilters {
  status?: string;
  direction?: string;
  to?: string;
  error?: string;
  projectId?: string;
  accountId?: string;
  cursor?: string;
  limit?: number;
}

export async function listMessages(f: MessageFilters) {
  const where: Record<string, unknown> = {};
  if (f.status) where.status = f.status.toUpperCase();
  if (f.direction) where.direction = f.direction.toUpperCase();
  if (f.error) where.errorCode = f.error;
  if (f.projectId) where.projectId = f.projectId;
  if (f.accountId) where.accountId = f.accountId;
  if (f.to) where.toNumber = { contains: f.to.replace(/\D/g, '') };
  if (f.cursor) where.id = { lt: f.cursor };

  const limit = f.limit ?? 50;
  const rows = await prisma.message.findMany({
    where,
    select: {
      id: true,
      direction: true,
      status: true,
      toNumber: true,
      fromNumber: true,
      externalId: true,
      errorCode: true,
      createdAt: true,
      sentAt: true,
      project: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  return { rows: rows.slice(0, limit), nextCursor: hasMore ? rows[limit - 1]?.id : null };
}

export async function getMessage(id: string) {
  const message = await prisma.message.findFirst({
    where: { id },
    include: {
      project: { select: { name: true } },
      apiToken: { select: { name: true } },
      account: { select: { label: true } },
    },
  });
  if (!message) return null;
  const attempts = await prisma.messageAttempt.findMany({
    where: { messageId: id },
    orderBy: { attemptNumber: 'asc' },
  });
  // resolve labels das contas usadas nas tentativas
  const accountIds = [...new Set(attempts.map((a) => a.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, label: true },
  });
  const accLabel = new Map(accounts.map((a) => [a.id, a.label]));

  return {
    message,
    attempts: attempts.map((a) => ({ ...a, accountLabel: accLabel.get(a.accountId) ?? a.accountId })),
  };
}

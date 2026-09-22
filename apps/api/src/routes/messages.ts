import type { FastifyInstance, FastifyReply } from 'fastify';
import { loadEnv } from '@wpp/config';
import { prisma, MessageStatus, isSuppressed } from '@wpp/database';
import {
  ApiError,
  sendMessageSchema,
  bulkMessageSchema,
  listMessagesQuerySchema,
  normalizePhone,
  tryNormalizePhone,
  startOfLocalDayUtc,
  secondsUntilNextLocalMidnight,
} from '@wpp/shared';
import { createAndEnqueue } from '@wpp/queue';

const env = loadEnv();

/**
 * Rotas de mensagens (doc 03 §3).
 * Todas exigem auth (registrada como preHandler no escopo pai).
 */
export function registerMessageRoutes(app: FastifyInstance): void {
  // ── POST /v1/messages ──────────────────────────────────────────────────────
  app.post('/messages', async (req, reply) => {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError('INVALID_PHONE_NUMBER', { issues: parsed.error.issues });
    }
    const body = parsed.data;

    let phone: string;
    try {
      phone = normalizePhone(body.to).e164;
    } catch {
      throw new ApiError('INVALID_PHONE_NUMBER', { field: 'to', value: body.to });
    }

    if (body.text.length > 4096) throw new ApiError('TEXT_TOO_LONG');

    if (await isSuppressed(phone)) throw new ApiError('RECIPIENT_OPTED_OUT', { to: phone });

    if (body.scheduledFor) {
      const when = new Date(body.scheduledFor).getTime();
      const maxAhead = Date.now() + 30 * 24 * 3600_000;
      if (Number.isNaN(when) || when < Date.now() || when > maxAhead) {
        throw new ApiError('INVALID_SCHEDULE');
      }
    }

    await enforceDailyQuota(req.auth.projectId, req.auth.dailyQuota, reply);

    const result = await createAndEnqueue({
      projectId: req.auth.projectId,
      apiTokenId: req.auth.apiTokenId,
      to: phone,
      text: body.text,
      externalId: body.externalId ?? null,
      preferredAccountId: body.preferredAccountId ?? null,
    });

    const message = await prisma.message.findFirst({
      where: { id: result.messageId },
      select: { id: true, status: true, externalId: true, createdAt: true, queuedAt: true },
    });

    // idempotência: já existia → 200; nova → 202 (doc 03 §3.1)
    reply.code(result.status === 'duplicate' ? 200 : 202);
    return {
      messageId: result.messageId,
      status: mapStatusToApi(message?.status ?? MessageStatus.QUEUED),
      to: phone,
      externalId: message?.externalId ?? null,
      createdAt: message?.createdAt.toISOString(),
    };
  });

  // ── POST /v1/messages/bulk ────────────────────────────────────────────────
  app.post('/messages/bulk', async (req, reply) => {
    const parsed = bulkMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError('INVALID_PHONE_NUMBER', { issues: parsed.error.issues });
    }

    await enforceDailyQuota(
      req.auth.projectId,
      req.auth.dailyQuota,
      reply,
      parsed.data.messages.length,
    );

    const accepted: Array<{ index: number; messageId: string; status: string }> = [];
    const errors: Array<{ index: number; code: string; message: string }> = [];

    for (let i = 0; i < parsed.data.messages.length; i++) {
      const m = parsed.data.messages[i]!;
      const norm = tryNormalizePhone(m.to);
      if (!norm) {
        errors.push({ index: i, code: 'INVALID_PHONE_NUMBER', message: 'Número inválido' });
        continue;
      }
      if (await isSuppressed(norm.e164)) {
        errors.push({ index: i, code: 'RECIPIENT_OPTED_OUT', message: 'Destinatário pediu opt-out' });
        continue;
      }
      const r = await createAndEnqueue({
        projectId: req.auth.projectId,
        apiTokenId: req.auth.apiTokenId,
        to: norm.e164,
        text: m.text,
        externalId: m.externalId ?? null,
        bulk: true,
      });
      accepted.push({ index: i, messageId: r.messageId, status: r.status === 'duplicate' ? 'duplicate' : 'queued' });
    }

    reply.code(202);
    return { accepted: accepted.length, rejected: errors.length, messages: accepted, errors };
  });

  // ── GET /v1/messages/:id ─────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/messages/:id', async (req) => {
    const msg = await prisma.message.findFirst({
      where: { id: req.params.id, projectId: req.auth.projectId },
      select: {
        id: true,
        status: true,
        toNumber: true,
        content: true,
        externalId: true,
        attemptCount: true,
        errorCode: true,
        errorMessage: true,
        createdAt: true,
        queuedAt: true,
        sentAt: true,
        deliveredAt: true,
        readAt: true,
        failedAt: true,
      },
    });
    // 404 (não 403) para não vazar existência de mensagem de outro projeto
    if (!msg) throw new ApiError('MESSAGE_NOT_FOUND');

    return {
      messageId: msg.id,
      status: mapStatusToApi(msg.status),
      to: msg.toNumber,
      text: msg.content,
      externalId: msg.externalId,
      attemptCount: msg.attemptCount,
      timeline: {
        createdAt: msg.createdAt.toISOString(),
        queuedAt: msg.queuedAt?.toISOString() ?? null,
        sentAt: msg.sentAt?.toISOString() ?? null,
        deliveredAt: msg.deliveredAt?.toISOString() ?? null,
        readAt: msg.readAt?.toISOString() ?? null,
        failedAt: msg.failedAt?.toISOString() ?? null,
      },
      error: msg.errorCode
        ? { code: msg.errorCode, message: msg.errorMessage ?? '', retryable: false }
        : null,
    };
  });

  // ── GET /v1/messages ─────────────────────────────────────────────────────
  app.get('/messages', async (req) => {
    const q = listMessagesQuerySchema.parse(req.query);
    const where: Record<string, unknown> = { projectId: req.auth.projectId };
    if (q.status) where.status = q.status.toUpperCase();
    if (q.direction) where.direction = q.direction;
    if (q.to) {
      const n = tryNormalizePhone(q.to);
      where.toNumber = n?.e164 ?? q.to;
    }
    if (q.from || q.until) {
      where.createdAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.until ? { lte: new Date(q.until) } : {}),
      };
    }
    if (q.cursor) {
      where.id = { lt: decodeCursor(q.cursor) };
    }

    const rows = await prisma.message.findMany({
      where,
      select: {
        id: true,
        status: true,
        direction: true,
        toNumber: true,
        fromNumber: true,
        externalId: true,
        createdAt: true,
        sentAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
    });

    const hasMore = rows.length > q.limit;
    const data = rows.slice(0, q.limit).map((m) => ({
      messageId: m.id,
      status: mapStatusToApi(m.status),
      direction: m.direction,
      to: m.toNumber,
      from: m.fromNumber,
      externalId: m.externalId,
      createdAt: m.createdAt.toISOString(),
      sentAt: m.sentAt?.toISOString() ?? null,
    }));

    return {
      data,
      pagination: {
        nextCursor: hasMore ? encodeCursor(data[data.length - 1]!.messageId) : null,
        hasMore,
      },
    };
  });

  // ── POST /v1/messages/:id/cancel ─────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/messages/:id/cancel', async (req) => {
    const msg = await prisma.message.findFirst({
      where: { id: req.params.id, projectId: req.auth.projectId },
      select: { id: true, status: true },
    });
    if (!msg) throw new ApiError('MESSAGE_NOT_FOUND');
    if (msg.status !== MessageStatus.QUEUED) throw new ApiError('MESSAGE_NOT_CANCELABLE');

    await prisma.message.updateMany({
      where: { id: msg.id, status: MessageStatus.QUEUED },
      data: { status: MessageStatus.CANCELED },
    });
    return { messageId: msg.id, status: 'canceled' };
  });
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Mapeia o enum interno para o vocabulário lowercase da API (doc 03). */
function mapStatusToApi(s: MessageStatus): string {
  return s.toLowerCase();
}

async function enforceDailyQuota(
  projectId: string,
  quota: number | null,
  reply: FastifyReply,
  count = 1,
): Promise<void> {
  if (quota === null) return;
  const now = new Date();
  const startOfDay = startOfLocalDayUtc(now, env.TENANT_TIMEZONE);
  const used = await prisma.message.count({
    where: { projectId, direction: 'OUTBOUND', createdAt: { gte: startOfDay } },
  });
  if (used + count > quota) {
    reply.header('Retry-After', secondsUntilNextLocalMidnight(now, env.TENANT_TIMEZONE));
    throw new ApiError('DAILY_QUOTA_EXCEEDED', { quota, used });
  }
}

function encodeCursor(id: string): string {
  return Buffer.from(id).toString('base64url');
}
function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf8');
}

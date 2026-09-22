import type { FastifyInstance } from 'fastify';
import { loadEnv } from '@wpp/config';
import { prisma, MessageDirection, MessageStatus } from '@wpp/database';
import { normalizePhone, classifySendError } from '@wpp/shared';
import { logger } from '../logger.js';
import type { SessionManager } from '../sessions/index.js';
import { sendTextCore } from '../sessions/index.js';
import { redis } from '../redis.js';
import { readCounters, incrCounters, markLastSend } from '../state/index.js';

const env = loadEnv();

/**
 * Rotas de chat da API interna (Fase 6c). Envio MANUAL do admin por uma conta
 * específica — sem sorteio, sem fila, sem projeto (project_id null). Mas
 * CONTA nos limites hora/dia da conta (anti-ban continua valendo).
 */
export function registerChatRoutes(app: FastifyInstance, manager: SessionManager): void {
  // ── POST /chat/send — enviar por uma conta específica ──────────────────
  app.post<{ Body: { accountId: string; to: string; text: string; simulateTyping?: boolean } }>(
    '/chat/send',
    async (req, reply) => {
      const { accountId, to, text, simulateTyping = true } = req.body ?? {};
      if (!accountId || !to || !text?.trim()) {
        void reply.code(422).send({ error: 'accountId, to e text são obrigatórios' });
        return;
      }

      let phone: string;
      try {
        phone = normalizePhone(to).e164;
      } catch {
        void reply.code(422).send({ error: 'número inválido' });
        return;
      }

      const account = await prisma.account.findUnique({ where: { id: accountId } });
      if (!account) {
        void reply.code(404).send({ error: 'conta não encontrada' });
        return;
      }

      // limites anti-ban da conta (doc 06 §2) — bloqueia se estourou
      const counters = await readCounters(redis, accountId, env.TENANT_TIMEZONE);
      if (counters.hour >= account.hourlyLimit) {
        void reply.code(429).send({ error: `conta no limite horário (${account.hourlyLimit})` });
        return;
      }
      if (counters.day >= account.dailyLimit) {
        void reply.code(429).send({ error: `conta no limite diário (${account.dailyLimit})` });
        return;
      }

      const session = manager.active.get(accountId);
      if (!session?.isReady) {
        void reply.code(503).send({ error: 'sessão da conta não está pronta' });
        return;
      }

      // grava a mensagem outbound (sem projeto — é envio do admin)
      const message = await prisma.message.create({
        data: {
          direction: MessageDirection.OUTBOUND,
          status: MessageStatus.SENDING,
          accountId,
          toNumber: phone,
          content: text,
          queuedAt: new Date(),
        },
        select: { id: true, createdAt: true },
      });

      const outcome = await sendTextCore(session, phone, text, {
        checkExistence: false, // se o contato já falou com a gente, existe
        simulateTyping,
      });

      await prisma.messageAttempt.create({
        data: {
          messageId: message.id,
          accountId,
          attemptNumber: 1,
          result: outcome.ok ? 'SUCCESS' : 'FAILED',
          errorCode: outcome.errorCode ?? null,
          errorMessage: outcome.errorMessage ?? null,
          durationMs: outcome.durationMs,
        },
      });

      if (!outcome.ok) {
        await prisma.message.updateMany({
          where: { id: message.id },
          data: {
            status: MessageStatus.FAILED,
            errorCode: outcome.errorCode ?? classifySendError({}),
            errorMessage: outcome.errorMessage ?? null,
            failedAt: new Date(),
          },
        });
        void reply.code(502).send({ error: outcome.errorMessage ?? 'falha no envio', code: outcome.errorCode });
        return;
      }

      // sucesso: contadores + ack
      await incrCounters(redis, accountId, env.TENANT_TIMEZONE);
      await markLastSend(redis, accountId);
      const ack = await session.waitForAck(outcome.whatsappMessageId ?? '', 15_000);
      const now = new Date();
      await prisma.message.updateMany({
        where: { id: message.id },
        data: {
          status:
            ack === 'read' || ack === 'played'
              ? MessageStatus.READ
              : ack === 'delivery_ack'
                ? MessageStatus.DELIVERED
                : MessageStatus.SENT,
          whatsappMessageId: outcome.whatsappMessageId,
          sentAt: now,
          deliveredAt: ack === 'delivery_ack' || ack === 'read' || ack === 'played' ? now : null,
          attemptCount: 1,
        },
      });

      logger.info({ messageId: message.id, accountId, to: phone, ack }, 'mensagem do chat enviada');
      return { messageId: message.id, ack, createdAt: message.createdAt.toISOString() };
    },
  );

  // ── POST /chat/typing — emitir "digitando" pela conta ────────────────
  app.post<{ Body: { accountId: string; to: string; state: 'composing' | 'paused' } }>(
    '/chat/typing',
    async (req, reply) => {
      const { accountId, to, state } = req.body ?? {};
      const session = manager.active.get(accountId);
      if (!session?.socket || !session.isReady) {
        void reply.code(503).send({ error: 'sessão não pronta' });
        return;
      }
      try {
        const digits = to.replace(/\D/g, '');
        await session.socket.sendPresenceUpdate(state, `${digits}@s.whatsapp.net`);
      } catch {
        // presença é best-effort
      }
      return { ok: true };
    },
  );

  // ── GET /chat/stream — SSE de mensagens novas (inbound) ──────────────
  app.get('/chat/stream', (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');

    const onInbound = (accountId: string, from: string, text: string) => {
      reply.raw.write(
        `event: inbound\ndata: ${JSON.stringify({ accountId, from, text, at: new Date().toISOString() })}\n\n`,
      );
    };
    chatStreamBus.add(onInbound);

    const ka = setInterval(() => reply.raw.write(': keepalive\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ka);
      chatStreamBus.delete(onInbound);
    });
  });
}

/**
 * Bus simples de eventos de inbound para os streams SSE abertos. O
 * handleInboundUpsert (sessions/inbound.ts) publica aqui.
 */
type InboundListener = (accountId: string, from: string, text: string) => void;
export const chatStreamBus = new Set<InboundListener>();

export function publishInboundToChat(accountId: string, from: string, text: string): void {
  for (const l of chatStreamBus) {
    try {
      l(accountId, from, text);
    } catch {
      // um listener quebrado não derruba os outros
    }
  }
}

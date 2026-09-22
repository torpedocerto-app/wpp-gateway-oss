import type { Job } from 'bullmq';
import { loadEnv } from '@wpp/config';
import { prisma, MessageStatus, AttemptResult, isSuppressed } from '@wpp/database';
import {
  selectAccount,
  computeSendDelayMs,
  silentHourDelayMs,
  SendErrorCode,
  FALLBACK_LIMITS,
  decideAfterAttempt,
} from '@wpp/shared';
import { logger } from '../logger.js';
import { redis } from '../redis.js';
import type { SessionManager } from '../sessions/index.js';
import { sendTextCore, sendMediaCore } from '../sessions/index.js';
import {
  acquireAccountLock,
  releaseAccountLock,
  incrCounters,
  markLastSend,
  setCooldown,
  getWaExistence,
  setWaExistence,
} from '../state/index.js';
import { buildAccountSnapshots } from './snapshot.js';
import {
  enqueueOutbound,
  OUTBOUND_PRIORITY,
  dispatchWebhook,
  type OutboundJobData,
} from '@wpp/queue';

/** Quanto o job espera na fila até virar EXPIRED_IN_QUEUE (doc 05 §2.4). */
const MAX_QUEUE_WAIT_MS = FALLBACK_LIMITS.MAX_QUEUE_WAIT_MS;

interface ProcessResult {
  status: 'sent' | 'failed' | 'requeued';
  detail: string;
}

/**
 * Processa um job de envio (doc 05 §4). Chamado pelo BullMQ Worker.
 *
 * Fluxo:
 *  1. valida idade do job (expira após 24h)
 *  2. checa existência no WhatsApp (cache → consulta) — Grupo A na origem
 *  3. sorteia conta elegível (exclui as já tentadas)
 *  4. adquire lock da conta
 *  5. aplica janela de silêncio + delay humanizado
 *  6. envia (com composing) e aguarda ack
 *  7. classifica o resultado → SENT | fallback | retry mesma conta | FAILED
 */
const env = loadEnv();

export async function processOutbound(
  job: Job<OutboundJobData>,
  manager: SessionManager,
): Promise<ProcessResult> {
  const { messageId, to, text, preferredAccountId, triedAccountIds, urgent, media } = job.data;

  const message = await prisma.message.findFirst({
    where: { id: messageId },
    select: { id: true, createdAt: true, status: true, externalId: true, projectId: true },
  });
  if (!message) {
    return { status: 'failed', detail: 'mensagem não encontrada no banco' };
  }
  if (message.status === MessageStatus.CANCELED) {
    return { status: 'failed', detail: 'mensagem cancelada pelo admin' };
  }
  if (message.status === MessageStatus.SENT || message.status === MessageStatus.DELIVERED) {
    return { status: 'sent', detail: 'já enviada (job duplicado)' };
  }

  // 1. Job velho demais → EXPIRED_IN_QUEUE
  if (Date.now() - message.createdAt.getTime() > MAX_QUEUE_WAIT_MS) {
    await failMessage(message.id, SendErrorCode.EXPIRED_IN_QUEUE, 'esperou >24h na fila');
    return { status: 'failed', detail: 'EXPIRED_IN_QUEUE' };
  }

  // 2. Existência no WhatsApp (Grupo A na origem, doc 05 §3.2)
  const cached = await getWaExistence(redis, to);
  if (cached === 'no') {
    await failMessage(message.id, SendErrorCode.NUMBER_NOT_ON_WHATSAPP, 'cache: número sem WhatsApp');
    return { status: 'failed', detail: 'NUMBER_NOT_ON_WHATSAPP (cache)' };
  }

  // 2b. Opt-out (Grupo A, doc 06 §5) — defesa em profundidade; a checagem
  // rápida já roda na API, mas o job pode ter sido enfileirado antes do
  // opt-out chegar, ou vir de um fallback antigo.
  if (await isSuppressed(to)) {
    await failMessage(message.id, SendErrorCode.RECIPIENT_OPTED_OUT, 'destinatário pediu opt-out');
    return { status: 'failed', detail: 'RECIPIENT_OPTED_OUT' };
  }

  // 3. Sorteia conta
  const snapshots = await buildAccountSnapshots(redis, manager);
  const accountId = selectAccount(snapshots, {
    preferredId: preferredAccountId,
    excludeIds: triedAccountIds,
  });

  if (!accountId) {
    return handleNoAccount(job, snapshots.length, triedAccountIds.length);
  }

  const session = manager.active.get(accountId);
  if (!session) {
    // Snapshot dizia socketOpen mas a sessão sumiu entre o snapshot e agora.
    // Trata como conta desconectada → fallback para outra conta.
    return handleSendFailure(
      job,
      message.id,
      accountId,
      SendErrorCode.ACCOUNT_DISCONNECTED,
      triedAccountIds.length + 1,
    );
  }

  // 4. Lock da conta (doc 05 §2.1)
  const lock = await acquireAccountLock(redis, accountId);
  if (!lock) {
    // Corrida: outra thread pegou o lock. Reenfileira com delay curto.
    await enqueueOutbound(job.data, { priority: job.opts.priority, delayMs: 2_000 });
    return { status: 'requeued', detail: `lock ocupado em ${accountId}` };
  }

  try {
    // 5. Janela de silêncio + delay humanizado (doc 05 §5)
    const silentDelay = silentHourDelayMs(new Date(), urgent ?? false, env.TENANT_TIMEZONE);
    if (silentDelay > 0) {
      await enqueueOutbound(job.data, { priority: job.opts.priority, delayMs: silentDelay });
      return { status: 'requeued', detail: `janela de silêncio: +${Math.round(silentDelay / 60000)}min` };
    }
    await sleep(computeSendDelayMs());

    // 6. Envia. checkExistence só se o cache não confirmou 'yes'.
    await prisma.message.updateMany({
      where: { id: message.id },
      data: { status: MessageStatus.SENDING, accountId },
    });

    const attemptNumber = triedAccountIds.length + 1;
    const outcome = media
      ? await sendMediaCore(
          session,
          to,
          {
            buffer: Buffer.from(media.data, 'base64'),
            mimetype: media.mimetype,
            fileName: media.fileName,
            caption: media.caption,
          },
          { checkExistence: cached !== 'yes', simulateTyping: true },
        )
      : await sendTextCore(session, to, text, {
          checkExistence: cached !== 'yes',
          simulateTyping: true,
        });

    await prisma.messageAttempt.create({
      data: {
        messageId: message.id,
        accountId,
        attemptNumber,
        result: outcome.ok ? AttemptResult.SUCCESS : AttemptResult.FAILED,
        errorCode: outcome.errorCode ?? null,
        errorMessage: outcome.errorMessage ?? null,
        durationMs: outcome.durationMs,
      },
    });

    if (outcome.ok) {
      // Cacheia existência positiva e atualiza contadores/cooldown.
      await setWaExistence(redis, to, true);
      await incrCounters(redis, accountId, env.TENANT_TIMEZONE);
      await markLastSend(redis, accountId);
      await setCooldown(redis, accountId, computeSendDelayMs());

      const ack = await session.waitForAck(outcome.whatsappMessageId ?? '', 20_000);
      const now = new Date();
      const finalStatus =
        ack === 'read' || ack === 'played'
          ? MessageStatus.READ
          : ack === 'delivery_ack'
            ? MessageStatus.DELIVERED
            : MessageStatus.SENT;
      await prisma.message.updateMany({
        where: { id: message.id },
        data: {
          status: finalStatus,
          accountId,
          whatsappMessageId: outcome.whatsappMessageId,
          sentAt: now,
          deliveredAt: ack === 'delivery_ack' || ack === 'read' || ack === 'played' ? now : null,
          readAt: ack === 'read' || ack === 'played' ? now : null,
          attemptCount: attemptNumber,
        },
      });
      await prisma.account.update({
        where: { id: accountId },
        data: { consecutiveFailures: 0 },
      });
      await emitStatusWebhook(message.id, message.projectId, message.externalId, to, finalStatus, null);
      logger.info({ messageId: message.id, accountId, ack }, 'mensagem enviada');
      return { status: 'sent', detail: `ack=${ack} via ${accountId}` };
    }

    // 7. Falhou — decide pela taxonomia (doc 05 §3)
    return handleSendFailure(job, message.id, accountId, outcome.errorCode!, attemptNumber);
  } finally {
    await releaseAccountLock(redis, lock);
  }
}

// ── decisão pós-falha ────────────────────────────────────────────────────────

/**
 * Aplica a decisão pura de `decideAfterAttempt` (doc 05 §4): persiste o efeito
 * e reenfileira quando for o caso.
 */
async function handleSendFailure(
  job: Job<OutboundJobData>,
  messageId: string,
  accountId: string,
  code: SendErrorCode,
  attemptNumber: number,
): Promise<ProcessResult> {
  // marca a conta (falhas consecutivas alimentam a heurística de shadow-ban)
  await prisma.account.update({
    where: { id: accountId },
    data: { consecutiveFailures: { increment: 1 }, lastError: code },
  });

  const decision = decideAfterAttempt({ ok: false, errorCode: code, attemptNumber });

  switch (decision.kind) {
    case 'fail': {
      if (code === SendErrorCode.NUMBER_NOT_ON_WHATSAPP) {
        await setWaExistence(redis, job.data.to, false);
      }
      await failMessage(messageId, code, decision.reason);
      return { status: 'failed', detail: code };
    }

    case 'retry_same_account': {
      await enqueueOutbound(job.data, {
        priority: OUTBOUND_PRIORITY.FALLBACK_RETRY,
        delayMs: decision.delayMs,
      });
      await backToQueued(messageId);
      return { status: 'requeued', detail: `retry mesma conta (${code})` };
    }

    case 'fallback_other_account': {
      await enqueueOutbound(
        { ...job.data, triedAccountIds: [...job.data.triedAccountIds, accountId] },
        { priority: OUTBOUND_PRIORITY.FALLBACK_RETRY, delayMs: decision.delayMs },
      );
      await backToQueued(messageId);
      logger.warn(
        { messageId, failedAccountId: accountId, tried: decision.nextTriedCount, code },
        'fallback para outra conta',
      );
      return { status: 'requeued', detail: `fallback #${decision.nextTriedCount} (${code})` };
    }

    default:
      // 'sent' nunca chega aqui (ok=false)
      await failMessage(messageId, code, 'decisão inesperada');
      return { status: 'failed', detail: code };
  }
}

async function handleNoAccount(
  job: Job<OutboundJobData>,
  poolSize: number,
  triedCount: number,
): Promise<ProcessResult> {
  // Se já tentamos contas e agora não há mais nenhuma → falha definitiva.
  if (triedCount > 0) {
    await failMessage(
      job.data.messageId,
      SendErrorCode.NO_ACCOUNTS_AVAILABLE,
      `sem contas elegíveis após ${triedCount} tentativas`,
    );
    return { status: 'failed', detail: 'NO_ACCOUNTS_AVAILABLE (pós-fallback)' };
  }

  // Nenhuma conta ainda — mantém QUEUED e tenta de novo em 60s (doc 05 §2.4).
  await enqueueOutbound(job.data, { priority: job.opts.priority, delayMs: 60_000 });
  logger.warn({ messageId: job.data.messageId, poolSize }, 'nenhuma conta elegível — reagendado +60s');
  return { status: 'requeued', detail: 'nenhuma conta elegível' };
}

// ── helpers de persistência ──────────────────────────────────────────────────

async function failMessage(messageId: string, code: SendErrorCode, msg: string): Promise<void> {
  await prisma.message.updateMany({
    where: { id: messageId },
    data: {
      status: MessageStatus.FAILED,
      errorCode: code,
      errorMessage: msg,
      failedAt: new Date(),
    },
  });
  const info = await prisma.message.findFirst({
    where: { id: messageId },
    select: { projectId: true, externalId: true, toNumber: true },
  });
  if (info) {
    await emitStatusWebhook(
      messageId,
      info.projectId,
      info.externalId,
      info.toNumber,
      MessageStatus.FAILED,
      { code, message: msg },
    );
  }
}

/**
 * Dispara o webhook `message.status` (doc 03 §4.2). Silencioso se a mensagem
 * não tem projeto (inbound não atribuído) ou o projeto não assinou o evento.
 */
async function emitStatusWebhook(
  messageId: string,
  projectId: string | null,
  externalId: string | null,
  toNumber: string,
  status: MessageStatus,
  error: { code: string; message: string } | null,
): Promise<void> {
  if (!projectId) return;
  await dispatchWebhook({
    projectId,
    event: 'message.status',
    messageId,
    data: {
      messageId,
      externalId,
      status: status.toLowerCase(),
      to: toNumber,
      error,
    },
  }).catch((err) => logger.error({ err, messageId }, 'falha ao despachar webhook de status'));
}

async function backToQueued(messageId: string): Promise<void> {
  await prisma.message.updateMany({
    where: { id: messageId, status: { in: [MessageStatus.SENDING] } },
    data: { status: MessageStatus.QUEUED },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

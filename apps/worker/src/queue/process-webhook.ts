import { lookup } from 'node:dns/promises';
import type { Job } from 'bullmq';
import { prisma, WebhookDeliveryStatus } from '@wpp/database';
import {
  buildWebhookHeaders,
  webhookRetryDelayMs,
  shouldRetryWebhook,
  isBlockedIp,
  isBlockedHostname,
  WEBHOOK_HEADERS,
} from '@wpp/shared';
import { enqueueWebhook, type WebhookJobData } from '@wpp/queue';
import { logger } from '../logger.js';

/** Timeout do POST ao webhook do consumidor (doc 03 §4.4). */
const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Em NODE_ENV=test o receptor de webhook roda em 127.0.0.1 e o protocolo é http.
 * Relaxamos o anti-SSRF SÓ nesse ambiente. Em produção, as regras valem sempre.
 */
const IS_TEST = process.env.NODE_ENV === 'test';

interface WebhookResult {
  status: 'delivered' | 'failed' | 'retrying';
  httpStatus?: number;
  detail: string;
}

/**
 * Entrega um webhook (doc 03 §4). Chamado pelo BullMQ Worker.
 *
 * Fluxo:
 *  1. carrega a delivery + webhook_url/secret do projeto
 *  2. resolve o DNS do host AGORA e rejeita se apontar para IP privado/metadata
 *     (anti-SSRF, doc 08 §5 — validar só no cadastro é insuficiente)
 *  3. POST com HMAC, timeout 10s, sem seguir redirects
 *  4. 2xx → DELIVERED · 4xx (≠429) → FAILED · resto → retry com backoff
 */
export async function processWebhook(job: Job<WebhookJobData>): Promise<WebhookResult> {
  const { deliveryId, projectId, event, bodyRaw, attemptsMade } = job.data;

  const [delivery, project] = await Promise.all([
    prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true },
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { webhookUrl: true, webhookSecret: true },
    }),
  ]);

  if (!delivery) return { status: 'failed', detail: 'delivery não encontrada' };
  if (delivery.status === WebhookDeliveryStatus.DELIVERED) {
    return { status: 'delivered', detail: 'já entregue (job duplicado)' };
  }
  if (!project?.webhookUrl || !project.webhookSecret) {
    await markFailed(deliveryId, null, 'projeto sem webhook_url/secret');
    return { status: 'failed', detail: 'projeto sem webhook configurado' };
  }

  // ── anti-SSRF: resolve o host agora ──────────────────────────────────────
  let url: URL;
  try {
    url = new URL(project.webhookUrl);
  } catch {
    await markFailed(deliveryId, null, 'webhook_url inválida');
    return { status: 'failed', detail: 'URL inválida' };
  }
  if (!IS_TEST && (url.protocol !== 'https:' || isBlockedHostname(url.hostname))) {
    await markFailed(deliveryId, null, 'webhook_url bloqueada (protocolo/hostname)');
    return { status: 'failed', detail: 'URL bloqueada' };
  }
  if (!IS_TEST) {
    try {
      const { address } = await lookup(url.hostname);
      if (isBlockedIp(address)) {
        await markFailed(deliveryId, null, `host resolve para IP bloqueado (${address})`);
        logger.warn({ deliveryId, host: url.hostname, address }, 'webhook anti-SSRF: IP bloqueado');
        return { status: 'failed', detail: `IP bloqueado: ${address}` };
      }
    } catch (err) {
      // DNS falhou → trata como transitório (retry)
      return scheduleRetry(job, deliveryId, 0, `DNS falhou: ${errMsg(err)}`);
    }
  }

  // ── POST ───────────────────────────────────────────────────────────────
  const headers = buildWebhookHeaders(project.webhookSecret, event, deliveryId, bodyRaw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  let httpStatus = 0;
  try {
    const res = await fetch(project.webhookUrl, {
      method: 'POST',
      redirect: 'manual', // não seguir redirects (doc 08 §5)
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_HEADERS.SIGNATURE]: headers.signature,
        [WEBHOOK_HEADERS.TIMESTAMP]: headers.timestamp,
        [WEBHOOK_HEADERS.EVENT]: headers.event,
        [WEBHOOK_HEADERS.DELIVERY]: headers.delivery,
      },
      body: bodyRaw,
    });
    httpStatus = res.status;
  } catch (err) {
    httpStatus = 0; // timeout / rede
    logger.warn({ deliveryId, err: errMsg(err) }, 'webhook POST falhou');
  } finally {
    clearTimeout(timer);
  }

  if (httpStatus >= 200 && httpStatus < 300) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.DELIVERED,
        httpStatus,
        attemptCount: attemptsMade + 1,
        deliveredAt: new Date(),
        nextRetryAt: null,
      },
    });
    logger.info({ deliveryId, event, httpStatus }, 'webhook entregue');
    return { status: 'delivered', httpStatus, detail: 'ok' };
  }

  if (!shouldRetryWebhook(httpStatus)) {
    await markFailed(deliveryId, httpStatus, `HTTP ${httpStatus} — sem retry`);
    return { status: 'failed', httpStatus, detail: `HTTP ${httpStatus}` };
  }

  return scheduleRetry(job, deliveryId, httpStatus, `HTTP ${httpStatus}`);
}

// ── helpers ────────────────────────────────────────────────────────────────

async function scheduleRetry(
  job: Job<WebhookJobData>,
  deliveryId: string,
  httpStatus: number,
  reason: string,
): Promise<WebhookResult> {
  const nextAttempt = job.data.attemptsMade + 1;
  const delay = webhookRetryDelayMs(nextAttempt);

  if (delay === null) {
    await markFailed(deliveryId, httpStatus || null, `esgotou ${nextAttempt} tentativas (${reason})`);
    logger.error({ deliveryId, reason }, 'webhook esgotou retries');
    return { status: 'failed', detail: `esgotado: ${reason}` };
  }

  const nextRetryAt = new Date(Date.now() + delay);
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { attemptCount: nextAttempt, httpStatus: httpStatus || null, nextRetryAt },
  });
  await enqueueWebhook({ ...job.data, attemptsMade: nextAttempt }, { delayMs: delay });

  logger.warn({ deliveryId, nextAttempt, delayMs: delay, reason }, 'webhook será retentado');
  return { status: 'retrying', httpStatus: httpStatus || undefined, detail: `retry #${nextAttempt}` };
}

async function markFailed(
  deliveryId: string,
  httpStatus: number | null,
  detail: string,
): Promise<void> {
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: WebhookDeliveryStatus.FAILED,
      httpStatus,
      nextRetryAt: null,
    },
  });
  logger.warn({ deliveryId, detail }, 'webhook FAILED');
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

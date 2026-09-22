import { prisma, WebhookDeliveryStatus } from '@wpp/database';
import { enqueueWebhook } from './queues.js';

/**
 * Cria uma linha em `webhook_deliveries` e enfileira o job de entrega.
 *
 * Chamado pelo worker quando:
 *  - o status de uma mensagem muda (sent/delivered/read/failed) → `message.status`
 *  - uma mensagem inbound é atribuída a um projeto → `message.received`
 *
 * Só dispara se o projeto tem `webhook_url` E assinou o evento em `webhook_events`.
 */

export type WebhookEventName = 'message.status' | 'message.received';

interface DispatchInput {
  projectId: string;
  event: WebhookEventName | 'webhook.test';
  /** payload do campo `data` do webhook (doc 03 §4.2 / §4.3). */
  data: Record<string, unknown>;
  /** id da mensagem relacionada, para rastreio em webhook_deliveries. */
  messageId?: string | null;
  /** ignora a checagem de webhook_events (usado pelo endpoint de teste). */
  bypassEventFilter?: boolean;
}

export interface DispatchResult {
  dispatched: boolean;
  reason?: 'no_webhook_url' | 'event_not_subscribed' | 'no_secret';
  deliveryId?: string;
}

export async function dispatchWebhook(input: DispatchInput): Promise<DispatchResult> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { webhookUrl: true, webhookSecret: true, webhookEvents: true, isActive: true },
  });

  if (!project?.webhookUrl || !project.isActive) {
    return { dispatched: false, reason: 'no_webhook_url' };
  }
  if (!input.bypassEventFilter && !project.webhookEvents.includes(input.event)) {
    return { dispatched: false, reason: 'event_not_subscribed' };
  }
  if (!project.webhookSecret) {
    return { dispatched: false, reason: 'no_secret' };
  }

  // O corpo é serializado UMA vez aqui e é exatamente o que o HMAC assina.
  const body = JSON.stringify({
    event: input.event,
    timestamp: new Date().toISOString(),
    data: input.data,
  });

  const delivery = await prisma.webhookDelivery.create({
    data: {
      projectId: input.projectId,
      messageId: input.messageId ?? null,
      eventType: input.event,
      payload: JSON.parse(body) as object,
      status: WebhookDeliveryStatus.PENDING,
      attemptCount: 0,
    },
    select: { id: true },
  });

  await enqueueWebhook({
    deliveryId: delivery.id,
    projectId: input.projectId,
    event: input.event,
    bodyRaw: body,
    attemptsMade: 0,
  });

  return { dispatched: true, deliveryId: delivery.id };
}

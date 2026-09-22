import type { FastifyInstance } from 'fastify';
import { prisma } from '@wpp/database';
import { ApiError, checkWebhookUrl } from '@wpp/shared';
import { dispatchWebhook } from '@wpp/queue';

/**
 * POST /v1/webhook/test — dispara um webhook de teste para o projeto autenticado
 * (doc 07 §5.1 "botão Testar"). O consumidor usa isto para validar sua
 * assinatura HMAC e endpoint antes de ir a produção.
 */
export function registerWebhookRoutes(app: FastifyInstance): void {
  app.post('/webhook/test', async (req, reply) => {
    const project = await prisma.project.findUnique({
      where: { id: req.auth.projectId },
      select: { webhookUrl: true, webhookSecret: true },
    });

    if (!project?.webhookUrl) {
      throw new ApiError('MESSAGE_NOT_FOUND', { detail: 'projeto sem webhook_url configurada' });
    }
    if (!project.webhookSecret) {
      throw new ApiError('MESSAGE_NOT_FOUND', { detail: 'projeto sem webhook_secret' });
    }
    const urlCheck = checkWebhookUrl(project.webhookUrl);
    if (!urlCheck.ok) {
      throw new ApiError('INVALID_PHONE_NUMBER', {
        field: 'webhook_url',
        reason: urlCheck.reason,
      });
    }

    const result = await dispatchWebhook({
      projectId: req.auth.projectId,
      event: 'webhook.test',
      bypassEventFilter: true,
      data: {
        test: true,
        note: 'Webhook de teste — POST /v1/webhook/test',
        timestamp: new Date().toISOString(),
      },
    });

    reply.code(202);
    return {
      dispatched: result.dispatched,
      deliveryId: result.deliveryId ?? null,
      message: result.dispatched
        ? 'Webhook de teste enfileirado. Verifique seu endpoint.'
        : `Não enfileirado: ${result.reason ?? 'motivo desconhecido'}`,
    };
  });
}

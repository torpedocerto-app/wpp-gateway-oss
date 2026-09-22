import { Worker } from 'bullmq';
import { makeQueueConnection, QUEUE_NAMES, type WebhookJobData } from '@wpp/queue';
import { logger } from '../logger.js';
import { processWebhook } from './process-webhook.js';

/**
 * BullMQ Worker da fila `webhook` (doc 05 §1). Concorrência 10 — entregas a
 * projetos diferentes não competem entre si.
 */
export function startWebhookWorker(): Worker<WebhookJobData> {
  const worker = new Worker<WebhookJobData>(
    QUEUE_NAMES.WEBHOOK,
    async (job) => {
      const result = await processWebhook(job);
      logger.debug({ jobId: job.id, ...result }, 'job webhook processado');
      return result;
    },
    { connection: makeQueueConnection(), concurrency: 10 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'job webhook falhou inesperadamente');
  });

  logger.info('webhook worker iniciado');
  return worker;
}

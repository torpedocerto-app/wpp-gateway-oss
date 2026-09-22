import { Worker } from 'bullmq';
import { makeQueueConnection, QUEUE_NAMES, type OutboundJobData } from '@wpp/queue';
import { logger } from '../logger.js';
import type { SessionManager } from '../sessions/index.js';
import { processOutbound } from './process-outbound.js';

/**
 * BullMQ Worker da fila `outbound`.
 *
 * Concorrência = tamanho do pool + folga. O lock Redis por conta (doc 05 §2.1)
 * é o que realmente garante 1 envio por conta por vez; a concorrência aqui só
 * permite que contas DIFERENTES enviem em paralelo.
 */
export function startOutboundWorker(manager: SessionManager, poolSize: number): Worker<OutboundJobData> {
  const concurrency = Math.max(2, poolSize + 2);

  const worker = new Worker<OutboundJobData>(
    QUEUE_NAMES.OUTBOUND,
    async (job) => {
      const result = await processOutbound(job, manager);
      logger.debug({ jobId: job.id, ...result }, 'job outbound processado');
      return result;
    },
    {
      connection: makeQueueConnection(),
      concurrency,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'job outbound falhou inesperadamente');
  });

  logger.info({ concurrency }, 'outbound worker iniciado');
  return worker;
}

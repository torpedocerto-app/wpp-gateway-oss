import type { FastifyInstance } from 'fastify';
import { outboundQueue, webhookQueue } from '@wpp/queue';
import { logger } from '../logger.js';

/**
 * Rotas de gestão da fila para o painel (`/queue`, Fase 6b).
 * Só leitura + ações de manutenção — o processamento continua no worker.
 */
export function registerQueueRoutes(app: FastifyInstance): void {
  // ── GET /queue/status ──────────────────────────────────────────────────
  app.get('/queue/status', async () => {
    const [outCounts, whCounts] = await Promise.all([
      outboundQueue().getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused'),
      webhookQueue().getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused'),
    ]);
    const isPaused = await outboundQueue().isPaused();
    return { outbound: outCounts, webhook: whCounts, outboundPaused: isPaused };
  });

  // ── GET /queue/jobs?state=waiting|delayed|failed&limit=50 ──────────────
  app.get<{ Querystring: { state?: string; limit?: string } }>('/queue/jobs', async (req) => {
    const state = (req.query.state ?? 'waiting') as
      | 'waiting'
      | 'delayed'
      | 'failed'
      | 'active';
    const limit = Math.min(200, Number(req.query.limit ?? 50));
    const jobs = await outboundQueue().getJobs([state], 0, limit - 1);

    return {
      jobs: jobs.map((j) => ({
        id: j.id,
        name: j.name,
        priority: j.opts.priority,
        delayUntil: j.opts.delay ? new Date(j.timestamp + j.opts.delay).toISOString() : null,
        attemptsMade: j.attemptsMade,
        failedReason: j.failedReason ?? null,
        data: {
          messageId: (j.data as { messageId?: string }).messageId,
          to: (j.data as { to?: string }).to,
          triedAccountIds: (j.data as { triedAccountIds?: string[] }).triedAccountIds ?? [],
        },
        addedAt: new Date(j.timestamp).toISOString(),
      })),
    };
  });

  // ── POST /queue/pause | resume ────────────────────────────────────────
  app.post('/queue/pause', async () => {
    await outboundQueue().pause();
    logger.warn('fila outbound PAUSADA pelo painel');
    return { ok: true, paused: true };
  });
  app.post('/queue/resume', async () => {
    await outboundQueue().resume();
    logger.info('fila outbound retomada pelo painel');
    return { ok: true, paused: false };
  });

  // ── POST /queue/retry-failed — re-enfileira jobs falhados ────────────
  app.post('/queue/retry-failed', async () => {
    const failed = await outboundQueue().getJobs(['failed'], 0, 199);
    let retried = 0;
    for (const j of failed) {
      await j.retry().catch(() => undefined);
      retried++;
    }
    logger.info({ retried }, 'jobs falhados re-enfileirados pelo painel');
    return { ok: true, retried };
  });

  // ── POST /queue/clean-completed ─────────────────────────────────────
  app.post('/queue/clean-completed', async () => {
    const removed = await outboundQueue().clean(0, 5000, 'completed');
    return { ok: true, removed: removed.length };
  });
}

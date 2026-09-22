import type { FastifyInstance } from 'fastify';
import { prisma, AccountStatus } from '@wpp/database';
import { outboundQueue } from '@wpp/queue';

/**
 * GET /v1/health — saúde do pool (doc 03 §3.7).
 * NÃO expõe números de telefone: o projeto consumidor não precisa saber quais são.
 * Não exige autenticação.
 */
export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/health', async () => {
    const [total, available, counts] = await Promise.all([
      prisma.account.count({ where: { status: { not: AccountStatus.BANNED } } }),
      prisma.account.count({ where: { status: AccountStatus.CONNECTED, isEnabled: true } }),
      outboundQueue().getJobCounts('waiting', 'delayed', 'active'),
    ]);

    const queueDepth = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
    const status = available >= 2 ? 'healthy' : available === 1 ? 'degraded' : 'unavailable';

    return {
      status,
      accountsTotal: total,
      accountsAvailable: available,
      queueDepth,
      // estimativa grosseira: ~15s por mensagem por conta disponível
      estimatedDelaySeconds:
        available > 0 ? Math.round((queueDepth / available) * 15) : null,
    };
  });
}

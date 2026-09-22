/**
 * Processo worker de longa duração.
 *
 * Fase 1: mantém as sessões WhatsApp vivas (bootstrap + reconexão + health check).
 * Fase 2: consome a fila `outbound` — sorteio de conta, delays, fallback.
 * Fase 4 adiciona: captura de inbound e emissão de webhooks.
 *
 * ⚠️ Instância ÚNICA (ADR-002).
 */
import { loadEnv } from '@wpp/config';
import { prisma, AccountStatus } from '@wpp/database';
import { AlertType } from '@wpp/shared';
import { logger } from './logger.js';
import { SessionManager } from './sessions/index.js';
import { startOutboundWorker, startWebhookWorker, closeQueues } from './queue/index.js';
import { AlertService, PoolMonitor } from './alerts/index.js';
import { startInternalApi } from './internal-api/server.js';
import { RetentionScheduler } from './retention/index.js';
import { redis } from './redis.js';

const env = loadEnv();

// ⚠️ SEGURANÇA: o worker jamais roda em NODE_ENV=test. Um worker de dev deixado
// aberto durante `vitest` chegou a consumir jobs criados pelos testes de
// contrato da API e disparar mensagens reais (Fase 3). A fila de teste tem
// nome próprio (`outbound-test`), mas este guard é a trava dura.
if (env.NODE_ENV === 'test') {
  logger.error('worker não pode rodar com NODE_ENV=test — abortando');
  process.exit(1);
}

async function main(): Promise<void> {
  logger.info({ sessionsPath: env.SESSIONS_PATH }, 'worker iniciando');

  const manager = new SessionManager(env.SESSIONS_PATH);
  const alerts = new AlertService(manager);

  // Alerta quando uma sessão entra em estado terminal (ban / disconnect sem retry).
  manager.setGlobalEvents({
    onTerminal: (accountId, reason) => {
      void handleTerminalAlert(alerts, accountId, reason);
    },
  });

  await manager.bootstrap();
  logger.info({ sessions: manager.active.size }, 'sessões no ar');

  const outboundWorker = startOutboundWorker(manager, manager.active.size);
  const webhookWorker = startWebhookWorker();

  const poolMonitor = new PoolMonitor(manager, alerts);
  poolMonitor.start();

  const internalApi = await startInternalApi(manager);

  // Retenção de dados + criação antecipada de partições (doc 02 §3).
  const retention = new RetentionScheduler(alerts);
  retention.start();

  logger.info('worker pronto');

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'encerrando worker');
    void (async () => {
      poolMonitor.stop();
      retention.stop();
      await internalApi?.close();
      await outboundWorker.close();
      await webhookWorker.close();
      await closeQueues();
      await manager.shutdown();
      await redis.quit();
      await prisma.$disconnect();
      process.exit(0);
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Alerta de conta banida / desconectada (doc 04 §6.3). Reporta o tamanho
 * restante do pool na mensagem.
 */
async function handleTerminalAlert(
  alerts: AlertService,
  accountId: string,
  reason: string,
): Promise<void> {
  const acc = await prisma.account.findUnique({
    where: { id: accountId },
    select: { label: true, phoneNumber: true, status: true },
  });
  if (!acc) return;

  const remaining = await prisma.account.count({
    where: { status: AccountStatus.CONNECTED, isEnabled: true },
  });
  const total = await prisma.account.count({ where: { status: { not: AccountStatus.BANNED } } });

  const banned = acc.status === AccountStatus.BANNED;
  const type = banned ? AlertType.ACCOUNT_BANNED : AlertType.ACCOUNT_DISCONNECTED;
  const title = banned
    ? `Conta "${acc.label}" foi BANIDA`
    : `Conta "${acc.label}" desconectou`;
  const body =
    `Número: ${acc.phoneNumber ?? '(desconhecido)'}\n` +
    `Motivo: ${reason}\n` +
    `Horário: ${new Date().toLocaleString('pt-BR', { timeZone: env.TENANT_TIMEZONE })}\n\n` +
    `A conta foi removida do pool. Pool: ${remaining} de ${total} contas ativas.\n\n` +
    `→ ${env.PANEL_PUBLIC_URL}/accounts/${accountId}`;

  await alerts.fire(type, title, body, { entityId: accountId, excludeAccountId: accountId });
}

main().catch((err) => {
  logger.error({ err }, 'worker falhou ao iniciar');
  process.exit(1);
});

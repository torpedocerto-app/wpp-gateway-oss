import { loadEnv } from '@wpp/config';
import { prisma, AccountStatus, MessageStatus, MessageDirection } from '@wpp/database';
import { AlertType, evaluateAccountHealth } from '@wpp/shared';
import { outboundQueue } from '@wpp/queue';
import { redis } from '../redis.js';
import { logger } from '../logger.js';
import type { SessionManager } from '../sessions/index.js';
import type { AlertService } from './service.js';
import { isInCooldown } from '../state/index.js';

const env = loadEnv();

/** Fila acima disto → alerta (doc 04 §6.3). */
const QUEUE_ALERT_THRESHOLD = 500;
/** Intervalo do monitor de pool (doc 04 §5 usa 60s para health check; aqui idem). */
const MONITOR_INTERVAL_MS = 60_000;

/**
 * Job periódico (Fase 5) que vigia o pool e a fila, dispara alertas e coloca
 * contas suspeitas em quarentena (doc 04 §4, §6).
 */
export class PoolMonitor {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly manager: SessionManager,
    private readonly alerts: AlertService,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), MONITOR_INTERVAL_MS);
    logger.info('pool monitor iniciado');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    try {
      await this.checkPoolSize();
      await this.checkQueueDepth();
      await this.checkAccountHealth();
    } catch (err) {
      logger.error({ err }, 'pool monitor: erro no tick');
    }
  }

  // ── pool baixo / vazio (doc 04 §6.3) ────────────────────────────────────
  private async checkPoolSize(): Promise<void> {
    const active = await prisma.account.count({
      where: { status: AccountStatus.CONNECTED, isEnabled: true },
    });
    const total = await prisma.account.count({
      where: { status: { not: AccountStatus.BANNED } },
    });

    if (active === 0 && total > 0) {
      await this.alerts.fire(
        AlertType.POOL_EMPTY,
        'Pool sem contas ativas',
        `Nenhuma conta WhatsApp está conectada. Nenhuma mensagem será enviada até ` +
          `você reconectar ou adicionar uma conta.\n\n→ ${env.PANEL_PUBLIC_URL}/accounts`,
        { entityId: null },
      );
    } else if (active <= 1 && total >= 2) {
      await this.alerts.fire(
        AlertType.POOL_LOW,
        `Pool com apenas ${active} conta ativa`,
        `Só ${active} de ${total} contas estão ativas. Uma queda deixa o gateway sem ` +
          `capacidade de envio.\n\n→ ${env.PANEL_PUBLIC_URL}/accounts`,
        { entityId: null },
      );
    } else if (active >= 2) {
      // condição normalizou → limpa escalonamento
      await this.alerts.clearEscalation(AlertType.POOL_EMPTY);
      await this.alerts.clearEscalation(AlertType.POOL_LOW);
    }
  }

  // ── fila entupida (doc 04 §6.3) ────────────────────────────────────────
  private async checkQueueDepth(): Promise<void> {
    const counts = await outboundQueue().getJobCounts('waiting', 'delayed');
    const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0);
    if (depth > QUEUE_ALERT_THRESHOLD) {
      await this.alerts.fire(
        AlertType.QUEUE_BACKED_UP,
        `Fila de envio com ${depth} mensagens`,
        `A fila outbound acumulou ${depth} jobs (limite de alerta: ${QUEUE_ALERT_THRESHOLD}). ` +
          `Verifique se as contas estão enviando.`,
        { entityId: null },
      );
    }
  }

  // ── heurísticas de shadow-ban → quarentena (doc 04 §4) ─────────────────
  private async checkAccountHealth(): Promise<void> {
    const accounts = await prisma.account.findMany({
      where: { status: AccountStatus.CONNECTED, isEnabled: true },
      select: { id: true, label: true, consecutiveFailures: true },
    });

    for (const acc of accounts) {
      // já em quarentena? pula
      if (await isInCooldown(redis, acc.id)) continue;
      const quarantineKey = `acct:${acc.id}:quarantine`;
      if ((await redis.exists(quarantineKey)) === 1) continue;

      const recent = await prisma.message.findMany({
        where: {
          accountId: acc.id,
          direction: MessageDirection.OUTBOUND,
          status: {
            in: [MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ, MessageStatus.FAILED],
          },
        },
        select: { status: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      const deliveryRate =
        recent.length >= 20
          ? recent.filter(
              (m) => m.status === MessageStatus.DELIVERED || m.status === MessageStatus.READ,
            ).length / recent.length
          : null;

      const sentWithoutAck = countLeading(recent, (m) => m.status === MessageStatus.SENT);

      const decision = evaluateAccountHealth({
        consecutiveFailures: acc.consecutiveFailures,
        recentDeliveryRate: deliveryRate,
        sentWithoutAck,
      });

      if (decision.quarantine) {
        await redis.set(quarantineKey, '1', 'PX', decision.durationMs);
        await prisma.accountEvent.create({
          data: {
            accountId: acc.id,
            type: 'BAN_DETECTED',
            detail: { kind: 'quarantine', reason: decision.reason, durationMs: decision.durationMs },
          },
        });
        await this.alerts.fire(
          AlertType.ACCOUNT_SUSPECT,
          `Conta "${acc.label}" em quarentena`,
          `Motivo: ${decision.reason}.\nA conta saiu do sorteio por ` +
            `${Math.round(decision.durationMs / 60_000)} min. Se persistir, considere remover.\n\n` +
            `→ ${env.PANEL_PUBLIC_URL}/accounts/${acc.id}`,
          { entityId: acc.id, excludeAccountId: acc.id },
        );
      }
    }
  }
}

/** Conta quantos elementos do início da lista satisfazem o predicado. */
function countLeading<T>(arr: T[], pred: (x: T) => boolean): number {
  let n = 0;
  for (const x of arr) {
    if (!pred(x)) break;
    n++;
  }
  return n;
}

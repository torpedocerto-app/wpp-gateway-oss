import { prisma } from '@wpp/database';
import {
  ALERT_RULES,
  AlertChannel,
  alertDedupKey,
  isWithinDedupWindow,
  type AlertType,
} from '@wpp/shared';
import { redis } from '../redis.js';
import { logger } from '../logger.js';
import type { SessionManager } from '../sessions/index.js';
import { sendViaWhatsApp, sendViaEmail } from './channels.js';

/**
 * Serviço central de alertas (doc 04 §6).
 *
 *  - deduplicação por (type, entityId) via chave Redis com TTL
 *  - cadeia de fallback: WhatsApp (conta saudável) → e-mail → painel
 *  - "painel" = registrar em account_events / log (o painel lê de lá, Fase 6)
 *  - escalonamento de POOL_EMPTY: reenvia até resolver
 */
export class AlertService {
  constructor(private readonly manager: SessionManager) {}

  /**
   * Dispara um alerta. Silencioso (retorna false) se suprimido por dedup.
   *
   * @param type       tipo do alerta (define severidade, canais, dedup)
   * @param title      linha de assunto / primeira linha
   * @param body       corpo do alerta (texto puro)
   * @param opts.entityId  id da conta/entidade — parte da chave de dedup
   * @param opts.excludeAccountId  conta a NÃO usar para o envio por WhatsApp
   *                               (tipicamente a que originou o alerta)
   */
  async fire(
    type: AlertType,
    title: string,
    body: string,
    opts: { entityId?: string | null; excludeAccountId?: string | null } = {},
  ): Promise<boolean> {
    const rule = ALERT_RULES[type];
    const dedupKey = alertDedupKey(type, opts.entityId ?? null);

    // dedup
    const lastRaw = await redis.get(dedupKey);
    const lastSentAt = lastRaw ? Number(lastRaw) : null;
    if (isWithinDedupWindow(type, lastSentAt)) {
      logger.debug({ type, entityId: opts.entityId }, 'alerta suprimido (dedup)');
      return false;
    }

    const text = `🚨 ${title}\n\n${body}`;
    let deliveredVia: AlertChannel | null = null;

    // cadeia de fallback conforme os canais da regra
    for (const channel of rule.channels) {
      if (channel === AlertChannel.WHATSAPP) {
        if (await sendViaWhatsApp(this.manager, text, opts.excludeAccountId)) {
          deliveredVia = AlertChannel.WHATSAPP;
          break;
        }
      } else if (channel === AlertChannel.EMAIL) {
        if (await sendViaEmail(title, body)) {
          deliveredVia = AlertChannel.EMAIL;
          break;
        }
      } else if (channel === AlertChannel.PANEL) {
        // sempre "entrega" no painel: registra em account_events se houver entidade
        if (opts.entityId) {
          await prisma.accountEvent
            .create({
              data: {
                accountId: opts.entityId,
                type: 'BAN_DETECTED', // reusa enum; detalhe carrega o tipo real
                detail: { alert: type, severity: rule.severity, title, body },
              },
            })
            .catch(() => undefined);
        }
        deliveredVia = AlertChannel.PANEL;
        break;
      }
    }

    // marca o envio para dedup (TTL = janela de dedup)
    await redis.set(dedupKey, Date.now(), 'PX', rule.dedupWindowMs);

    // escalonamento (POOL_EMPTY): agenda re-verificação
    if (rule.escalate && rule.escalateIntervalMs) {
      await redis.set(`alert:escalate:${type}`, '1', 'PX', rule.escalateIntervalMs);
    }

    logger.warn({ type, severity: rule.severity, deliveredVia, entityId: opts.entityId }, 'alerta disparado');
    return deliveredVia !== null;
  }

  /** Limpa o estado de escalonamento quando a condição é resolvida. */
  async clearEscalation(type: AlertType): Promise<void> {
    await redis.del(`alert:escalate:${type}`);
  }
}

import { prisma, type Prisma, type AccountEventType } from '@wpp/database';
import { logger } from '../logger.js';

/** Payload de detalhe aceito por `account_events.detail` (JSONB). */
export type EventDetail = Prisma.InputJsonValue;

/**
 * Registra um evento de conta em `account_events` (doc 02 §2.6, doc 04 §3).
 * Toda transição de estado relevante passa por aqui — é a trilha de auditoria
 * que o painel mostra na timeline da conta.
 */
export async function recordAccountEvent(
  accountId: string,
  type: AccountEventType,
  detail: EventDetail = {},
): Promise<void> {
  try {
    await prisma.accountEvent.create({
      data: { accountId, type, detail },
    });
    logger.debug({ accountId, type, detail }, 'account event');
  } catch (err) {
    // Um evento de auditoria que falha não pode derrubar o fluxo principal.
    logger.error({ err, accountId, type }, 'falha ao registrar account event');
  }
}

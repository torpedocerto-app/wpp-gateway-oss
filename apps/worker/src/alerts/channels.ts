import { loadEnv } from '@wpp/config';
import { getSettingOr, SETTING_KEYS } from '@wpp/database';
import { isEmailConfigured, sendEmail } from '@wpp/email';
import { logger } from '../logger.js';
import type { SessionManager } from '../sessions/index.js';
import { toJid } from '../sessions/index.js';

const env = loadEnv();

/**
 * Canais de entrega de alerta (doc 04 §6). Cada função retorna true/false —
 * quem chama decide o fallback para o próximo canal.
 */

/** Número do admin para alertas. Tabela `settings` vence o `.env`. */
export async function alertWhatsAppNumber(): Promise<string> {
  return getSettingOr(SETTING_KEYS.ALERT_WHATSAPP_NUMBER, env.ALERT_WHATSAPP_NUMBER);
}
export async function alertEmail(): Promise<string> {
  return getSettingOr(SETTING_KEYS.ALERT_EMAIL, env.ALERT_EMAIL);
}

/**
 * Envia o alerta por WhatsApp usando uma conta SAUDÁVEL do pool — nunca a conta
 * que originou o alerta (doc 04 §6.1).
 */
export async function sendViaWhatsApp(
  manager: SessionManager,
  text: string,
  excludeAccountId?: string | null,
): Promise<boolean> {
  const number = await alertWhatsAppNumber();
  const jid = toJid(number);

  for (const [accountId, session] of manager.active) {
    if (accountId === excludeAccountId) continue;
    if (!session.isReady) continue;
    try {
      await session.socket?.sendMessage(jid, { text });
      logger.info({ accountId, to: number }, 'alerta enviado por WhatsApp');
      return true;
    } catch (err) {
      logger.warn({ err, accountId }, 'falha ao enviar alerta por WhatsApp — tentando outra conta');
    }
  }
  logger.warn('nenhuma conta saudável para enviar alerta por WhatsApp');
  return false;
}

/** Fallback obrigatório: e-mail via SMTP (doc 04 §6.2). */
export async function sendViaEmail(subject: string, text: string): Promise<boolean> {
  if (!isEmailConfigured()) {
    logger.error('SMTP não configurado — alerta por e-mail impossível (doc 04 §6.2)');
    return false;
  }
  const to = await alertEmail();
  const ok = await sendEmail({ to, subject, text });
  if (ok) logger.info({ to }, 'alerta enviado por e-mail');
  else logger.error('falha ao enviar alerta por e-mail');
  return ok;
}

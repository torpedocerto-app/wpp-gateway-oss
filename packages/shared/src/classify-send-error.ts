import { SendErrorCode } from './send-errors.js';

/**
 * Traduz um erro bruto de envio (Baileys / rede / sessão) para um SendErrorCode
 * da taxonomia (doc 05 §3.1), que por sua vez determina a ação de recuperação.
 *
 * Entrada flexível: string de mensagem, código HTTP-like do @hapi/boom, ou
 * um flag de contexto que o worker já conhece (ex.: socket fechado).
 */
export interface SendErrorContext {
  /** Mensagem de erro (err.message) ou string livre. */
  message?: string;
  /** statusCode do @hapi/boom, se o erro for Boom. */
  boomStatus?: number;
  /** true se o worker detectou o socket fechado antes/durante o envio. */
  socketClosed?: boolean;
  /** true se o envio estourou o timeout do worker. */
  timedOut?: boolean;
  /** true se onWhatsApp() retornou que o número não existe. */
  numberNotOnWhatsApp?: boolean;
}

export function classifySendError(ctx: SendErrorContext): SendErrorCode {
  // Sinais diretos que o worker já resolveu.
  if (ctx.numberNotOnWhatsApp) return SendErrorCode.NUMBER_NOT_ON_WHATSAPP;
  if (ctx.timedOut) return SendErrorCode.SEND_TIMEOUT;
  if (ctx.socketClosed) return SendErrorCode.ACCOUNT_DISCONNECTED;

  // Códigos HTTP-like do Boom (mesmos do DisconnectReason).
  switch (ctx.boomStatus) {
    case 401:
    case 403:
      return SendErrorCode.ACCOUNT_BANNED;
    case 408:
      return SendErrorCode.SEND_TIMEOUT;
    case 428:
    case 440:
      return SendErrorCode.ACCOUNT_DISCONNECTED;
    case 500:
      return SendErrorCode.SESSION_ERROR;
    case 503:
      return SendErrorCode.WHATSAPP_SERVER_ERROR;
    case 429:
      return SendErrorCode.ACCOUNT_RATE_LIMITED;
  }

  // Heurística por texto da mensagem.
  const msg = (ctx.message ?? '').toLowerCase();
  if (/rate.?limit|too many|429/.test(msg)) return SendErrorCode.ACCOUNT_RATE_LIMITED;
  if (/time?d?.?out|timeout/.test(msg)) return SendErrorCode.SEND_TIMEOUT;
  if (/connection closed|not open|websocket|socket/.test(msg))
    return SendErrorCode.ACCOUNT_DISCONNECTED;
  if (/forbidden|unauthorized|logged.?out|banned/.test(msg)) return SendErrorCode.ACCOUNT_BANNED;
  if (/decrypt|encrypt|session|prekey|signal/.test(msg)) return SendErrorCode.SESSION_ERROR;
  if (/network|enotfound|econnreset|econnrefused|etimedout|dns/.test(msg))
    return SendErrorCode.NETWORK_ERROR;
  if (/blocked|not authorized to send|privacy/.test(msg))
    return SendErrorCode.BLOCKED_BY_RECIPIENT;
  if (/5\d\d|server error|internal/.test(msg)) return SendErrorCode.WHATSAPP_SERVER_ERROR;

  // Desconhecido: trata como transitório de infra (retry mesma conta).
  return SendErrorCode.INTERNAL_ERROR;
}

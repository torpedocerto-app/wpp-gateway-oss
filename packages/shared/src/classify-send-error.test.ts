import { describe, expect, it } from 'vitest';
import { classifySendError } from './classify-send-error.js';
import { SendErrorCode, shouldFallback, isPermanentFailure } from './send-errors.js';

describe('classifySendError (doc 05 §3.1)', () => {
  it('número sem WhatsApp → NUMBER_NOT_ON_WHATSAPP (permanente, sem fallback)', () => {
    const code = classifySendError({ numberNotOnWhatsApp: true });
    expect(code).toBe(SendErrorCode.NUMBER_NOT_ON_WHATSAPP);
    expect(isPermanentFailure(code)).toBe(true);
  });

  it('socket fechado → ACCOUNT_DISCONNECTED (fallback)', () => {
    const code = classifySendError({ socketClosed: true });
    expect(code).toBe(SendErrorCode.ACCOUNT_DISCONNECTED);
    expect(shouldFallback(code)).toBe(true);
  });

  it('timeout do worker → SEND_TIMEOUT (fallback)', () => {
    expect(classifySendError({ timedOut: true })).toBe(SendErrorCode.SEND_TIMEOUT);
    expect(shouldFallback(SendErrorCode.SEND_TIMEOUT)).toBe(true);
  });

  it('boom 401/403 → ACCOUNT_BANNED (fallback + alerta)', () => {
    expect(classifySendError({ boomStatus: 401 })).toBe(SendErrorCode.ACCOUNT_BANNED);
    expect(classifySendError({ boomStatus: 403 })).toBe(SendErrorCode.ACCOUNT_BANNED);
  });

  it('boom 429 → ACCOUNT_RATE_LIMITED (fallback)', () => {
    expect(classifySendError({ boomStatus: 429 })).toBe(SendErrorCode.ACCOUNT_RATE_LIMITED);
  });

  it('mensagem "connection closed" → ACCOUNT_DISCONNECTED', () => {
    expect(classifySendError({ message: 'Connection Closed' })).toBe(
      SendErrorCode.ACCOUNT_DISCONNECTED,
    );
  });

  it('mensagem de erro de sessão/criptografia → SESSION_ERROR', () => {
    expect(classifySendError({ message: 'failed to decrypt prekey message' })).toBe(
      SendErrorCode.SESSION_ERROR,
    );
  });

  it('erro de rede → NETWORK_ERROR (retry mesma conta)', () => {
    const code = classifySendError({ message: 'ENOTFOUND web.whatsapp.com' });
    expect(code).toBe(SendErrorCode.NETWORK_ERROR);
    expect(shouldFallback(code)).toBe(false);
  });

  it('bloqueio do destinatário → BLOCKED_BY_RECIPIENT (permanente)', () => {
    const code = classifySendError({ message: 'not authorized to send to this user' });
    expect(code).toBe(SendErrorCode.BLOCKED_BY_RECIPIENT);
    expect(isPermanentFailure(code)).toBe(true);
  });

  it('desconhecido → INTERNAL_ERROR (retry mesma conta)', () => {
    expect(classifySendError({ message: 'algo muito estranho' })).toBe(
      SendErrorCode.INTERNAL_ERROR,
    );
  });
});

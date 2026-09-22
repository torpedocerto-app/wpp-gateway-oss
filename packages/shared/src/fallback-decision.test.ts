import { describe, expect, it } from 'vitest';
import { decideAfterAttempt } from './fallback-decision.js';
import { SendErrorCode } from './send-errors.js';

describe('decideAfterAttempt (doc 05 §4)', () => {
  it('sucesso → sent', () => {
    expect(decideAfterAttempt({ ok: true, attemptNumber: 1 })).toEqual({ kind: 'sent' });
  });

  it('número sem WhatsApp → fail imediato, sem retry (a regra de ouro)', () => {
    const d = decideAfterAttempt({
      ok: false,
      errorCode: SendErrorCode.NUMBER_NOT_ON_WHATSAPP,
      attemptNumber: 1,
    });
    expect(d.kind).toBe('fail');
  });

  it('destinatário bloqueou → fail imediato (insistir é abuso)', () => {
    const d = decideAfterAttempt({
      ok: false,
      errorCode: SendErrorCode.BLOCKED_BY_RECIPIENT,
      attemptNumber: 1,
    });
    expect(d.kind).toBe('fail');
  });

  it('conta desconectada na 1ª tentativa → fallback para outra conta, delay 10s', () => {
    const d = decideAfterAttempt({
      ok: false,
      errorCode: SendErrorCode.ACCOUNT_DISCONNECTED,
      attemptNumber: 1,
    });
    expect(d).toMatchObject({ kind: 'fallback_other_account', delayMs: 10_000, nextTriedCount: 1 });
  });

  it('conta banida na 2ª tentativa → fallback, delay 30s', () => {
    const d = decideAfterAttempt({
      ok: false,
      errorCode: SendErrorCode.ACCOUNT_BANNED,
      attemptNumber: 2,
    });
    expect(d).toMatchObject({ kind: 'fallback_other_account', delayMs: 30_000, nextTriedCount: 2 });
  });

  it('fallback na 3ª tentativa → esgota, vira fail (máx 3 contas)', () => {
    const d = decideAfterAttempt({
      ok: false,
      errorCode: SendErrorCode.SEND_TIMEOUT,
      attemptNumber: 3,
    });
    expect(d.kind).toBe('fail');
  });

  it('erro de rede → retry na MESMA conta, não conta como tentativa de fallback', () => {
    const d = decideAfterAttempt({
      ok: false,
      errorCode: SendErrorCode.NETWORK_ERROR,
      attemptNumber: 1,
    });
    expect(d).toMatchObject({ kind: 'retry_same_account', delayMs: 15_000 });
  });

  it('erro de rede na 3ª tentativa → esgota', () => {
    const d = decideAfterAttempt({
      ok: false,
      errorCode: SendErrorCode.NETWORK_ERROR,
      attemptNumber: 3,
    });
    expect(d.kind).toBe('fail');
  });

  it('erro sem código → tratado como INTERNAL_ERROR (retry mesma conta)', () => {
    const d = decideAfterAttempt({ ok: false, attemptNumber: 1 });
    expect(d.kind).toBe('retry_same_account');
  });
});

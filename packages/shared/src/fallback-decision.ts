import { SendErrorCode, SEND_ERROR_RECOVERY, RecoveryAction, FALLBACK_LIMITS } from './send-errors.js';

/**
 * Decisão pura de "o que fazer após uma tentativa de envio" (doc 05 §4).
 * Sem I/O — o worker aplica a decisão (persistir, reenfileirar).
 */

export type FallbackAction =
  | { kind: 'sent' }
  | { kind: 'fail'; code: SendErrorCode; reason: string }
  | { kind: 'retry_same_account'; code: SendErrorCode; delayMs: number }
  | { kind: 'fallback_other_account'; code: SendErrorCode; delayMs: number; nextTriedCount: number };

export interface FallbackInput {
  /** true se o envio deu certo (ack >= server). */
  ok: boolean;
  /** código de erro classificado, se !ok. */
  errorCode?: SendErrorCode;
  /** número desta tentativa (1-based) = triedAccountIds.length + 1. */
  attemptNumber: number;
}

export function decideAfterAttempt(input: FallbackInput): FallbackAction {
  if (input.ok) return { kind: 'sent' };

  const code = input.errorCode ?? SendErrorCode.INTERNAL_ERROR;
  const action = SEND_ERROR_RECOVERY[code];

  if (action === RecoveryAction.FAIL_PERMANENT) {
    return { kind: 'fail', code, reason: `falha definitiva (${code})` };
  }

  if (action === RecoveryAction.RETRY_SAME_ACCOUNT) {
    if (input.attemptNumber >= FALLBACK_LIMITS.MAX_ATTEMPTS) {
      return { kind: 'fail', code, reason: `esgotou ${input.attemptNumber} tentativas (${code})` };
    }
    return { kind: 'retry_same_account', code, delayMs: 15_000 };
  }

  // FALLBACK_OTHER_ACCOUNT
  const nextTriedCount = input.attemptNumber; // esta conta agora entra em triedAccountIds
  if (nextTriedCount >= FALLBACK_LIMITS.MAX_ATTEMPTS) {
    return { kind: 'fail', code, reason: `fallback esgotado após ${nextTriedCount} contas (${code})` };
  }
  const [d1, d2] = FALLBACK_LIMITS.RETRY_DELAYS_MS;
  const delayMs = nextTriedCount === 1 ? d1 : d2;
  return { kind: 'fallback_other_account', code, delayMs, nextTriedCount };
}

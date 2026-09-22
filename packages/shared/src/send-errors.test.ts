import { describe, expect, it } from 'vitest';
import {
  SendErrorCode,
  SEND_ERROR_RECOVERY,
  RecoveryAction,
  shouldFallback,
  isPermanentFailure,
} from './send-errors.js';

describe('taxonomia de erros de envio (doc 05 §3)', () => {
  it('número sem WhatsApp é falha permanente, sem fallback', () => {
    expect(isPermanentFailure(SendErrorCode.NUMBER_NOT_ON_WHATSAPP)).toBe(true);
    expect(shouldFallback(SendErrorCode.NUMBER_NOT_ON_WHATSAPP)).toBe(false);
  });

  it('destinatário que bloqueou não gera fallback (insistir é abuso)', () => {
    expect(shouldFallback(SendErrorCode.BLOCKED_BY_RECIPIENT)).toBe(false);
  });

  it('conta desconectada gera fallback para outra conta', () => {
    expect(shouldFallback(SendErrorCode.ACCOUNT_DISCONNECTED)).toBe(true);
    expect(shouldFallback(SendErrorCode.ACCOUNT_BANNED)).toBe(true);
  });

  it('erro de rede faz retry na mesma conta, não fallback', () => {
    expect(SEND_ERROR_RECOVERY[SendErrorCode.NETWORK_ERROR]).toBe(
      RecoveryAction.RETRY_SAME_ACCOUNT,
    );
    expect(shouldFallback(SendErrorCode.NETWORK_ERROR)).toBe(false);
  });

  it('todo código tem uma ação de recuperação mapeada', () => {
    for (const code of Object.values(SendErrorCode)) {
      expect(SEND_ERROR_RECOVERY[code]).toBeDefined();
    }
  });
});

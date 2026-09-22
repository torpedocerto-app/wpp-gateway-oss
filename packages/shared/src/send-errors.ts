/**
 * Taxonomia de erros de ENVIO — o coração do fallback (doc 05 §3).
 *
 * Regra de ouro: só faz sentido tentar outra conta quando o problema é da conta.
 * Se o problema é do destinatário, tentar de novo só queima reputação de outra
 * conta pelo mesmo motivo.
 *
 * Cada código de erro pertence a um grupo que determina a ação de recuperação.
 */

/** O que fazer quando um envio falha com determinado código. */
export const RecoveryAction = {
  /** Grupo A: erro do destinatário. Falha definitiva, sem retry. */
  FAIL_PERMANENT: 'FAIL_PERMANENT',
  /** Grupo B: erro da conta remetente. Tentar outra conta (prioridade 1). */
  FALLBACK_OTHER_ACCOUNT: 'FALLBACK_OTHER_ACCOUNT',
  /** Grupo C: erro transitório de infra. Retry na MESMA conta com backoff. */
  RETRY_SAME_ACCOUNT: 'RETRY_SAME_ACCOUNT',
} as const;
export type RecoveryAction = (typeof RecoveryAction)[keyof typeof RecoveryAction];

/** Códigos de erro de envio (doc 05 §3.1). */
export const SendErrorCode = {
  // --- Grupo A: destinatário (sem fallback) ---
  NUMBER_NOT_ON_WHATSAPP: 'NUMBER_NOT_ON_WHATSAPP',
  INVALID_NUMBER_FORMAT: 'INVALID_NUMBER_FORMAT',
  BLOCKED_BY_RECIPIENT: 'BLOCKED_BY_RECIPIENT',
  RECIPIENT_PRIVACY_RESTRICTED: 'RECIPIENT_PRIVACY_RESTRICTED',
  /** Destinatário pediu opt-out (doc 06 §5) — nunca tentar outra conta. */
  RECIPIENT_OPTED_OUT: 'RECIPIENT_OPTED_OUT',

  // --- Grupo B: conta remetente (fallback para outra conta) ---
  ACCOUNT_DISCONNECTED: 'ACCOUNT_DISCONNECTED',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
  ACCOUNT_RATE_LIMITED: 'ACCOUNT_RATE_LIMITED',
  SEND_TIMEOUT: 'SEND_TIMEOUT',
  SESSION_ERROR: 'SESSION_ERROR',

  // --- Grupo C: infra transitória (retry mesma conta) ---
  NETWORK_ERROR: 'NETWORK_ERROR',
  WHATSAPP_SERVER_ERROR: 'WHATSAPP_SERVER_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // --- Fila (doc 05 §2.4) ---
  EXPIRED_IN_QUEUE: 'EXPIRED_IN_QUEUE',
  NO_ACCOUNTS_AVAILABLE: 'NO_ACCOUNTS_AVAILABLE',
} as const;
export type SendErrorCode = (typeof SendErrorCode)[keyof typeof SendErrorCode];

/** Mapa código → ação de recuperação. Única fonte de verdade para o fallback. */
export const SEND_ERROR_RECOVERY: Record<SendErrorCode, RecoveryAction> = {
  // Grupo A
  [SendErrorCode.NUMBER_NOT_ON_WHATSAPP]: RecoveryAction.FAIL_PERMANENT,
  [SendErrorCode.INVALID_NUMBER_FORMAT]: RecoveryAction.FAIL_PERMANENT,
  [SendErrorCode.BLOCKED_BY_RECIPIENT]: RecoveryAction.FAIL_PERMANENT,
  [SendErrorCode.RECIPIENT_PRIVACY_RESTRICTED]: RecoveryAction.FAIL_PERMANENT,
  [SendErrorCode.RECIPIENT_OPTED_OUT]: RecoveryAction.FAIL_PERMANENT,

  // Grupo B
  [SendErrorCode.ACCOUNT_DISCONNECTED]: RecoveryAction.FALLBACK_OTHER_ACCOUNT,
  [SendErrorCode.ACCOUNT_BANNED]: RecoveryAction.FALLBACK_OTHER_ACCOUNT,
  [SendErrorCode.ACCOUNT_RATE_LIMITED]: RecoveryAction.FALLBACK_OTHER_ACCOUNT,
  [SendErrorCode.SEND_TIMEOUT]: RecoveryAction.FALLBACK_OTHER_ACCOUNT,
  [SendErrorCode.SESSION_ERROR]: RecoveryAction.FALLBACK_OTHER_ACCOUNT,

  // Grupo C
  [SendErrorCode.NETWORK_ERROR]: RecoveryAction.RETRY_SAME_ACCOUNT,
  [SendErrorCode.WHATSAPP_SERVER_ERROR]: RecoveryAction.RETRY_SAME_ACCOUNT,
  [SendErrorCode.INTERNAL_ERROR]: RecoveryAction.RETRY_SAME_ACCOUNT,

  // Fila
  [SendErrorCode.EXPIRED_IN_QUEUE]: RecoveryAction.FAIL_PERMANENT,
  [SendErrorCode.NO_ACCOUNTS_AVAILABLE]: RecoveryAction.RETRY_SAME_ACCOUNT,
};

/** Limites do fallback (doc 05 §4.1). */
export const FALLBACK_LIMITS = {
  /** Máximo de tentativas. Além disso, provavelmente não é problema de conta. */
  MAX_ATTEMPTS: 3,
  /** Cada tentativa usa uma conta ainda não tentada. */
  DISTINCT_ACCOUNTS: true,
  /** Delays entre tentativas em ms — não emendar tentativas (parece robô). */
  RETRY_DELAYS_MS: [10_000, 30_000] as const,
  /** Mensagem esperando na fila além disto → FAILED (EXPIRED_IN_QUEUE). */
  MAX_QUEUE_WAIT_MS: 24 * 60 * 60 * 1000,
} as const;

/** `true` se o código dispara fallback para outra conta. */
export function shouldFallback(code: SendErrorCode): boolean {
  return SEND_ERROR_RECOVERY[code] === RecoveryAction.FALLBACK_OTHER_ACCOUNT;
}

/** `true` se o código é uma falha definitiva sem qualquer nova tentativa. */
export function isPermanentFailure(code: SendErrorCode): boolean {
  return SEND_ERROR_RECOVERY[code] === RecoveryAction.FAIL_PERMANENT;
}

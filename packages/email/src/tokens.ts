import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tokens de uso único do painel (recuperação de senha e convite).
 *
 * Funções puras — sem I/O. A persistência (tabela `admin_tokens`) vive em
 * `@wpp/database`. Guardamos apenas o sha256 do token; o valor cru só existe
 * no link enviado por email.
 */

/** TTL do token de recuperação de senha. */
export const RESET_TTL_MS = 30 * 60 * 1000; // 30 min
/** TTL do token de convite de novo usuário. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // 72 h

export interface GeneratedToken {
  /** Valor cru — vai no link, nunca é persistido. */
  raw: string;
  /** sha256 hex — é o que se grava e se indexa em `admin_tokens.token_hash`. */
  hash: string;
}

/** Gera um token novo (32 bytes de entropia, base64url) e seu hash. */
export function generateToken(): GeneratedToken {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

/** sha256 hex de um token cru. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Comparação em tempo constante de dois hashes hex. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** `true` se o instante de expiração já passou. */
export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

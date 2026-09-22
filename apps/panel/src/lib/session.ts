import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { env } from './env';

/**
 * Sessão do painel (doc 08 §3): cookie httpOnly + Secure + SameSite=Strict,
 * assinado com HMAC-SHA256(PANEL_SESSION_SECRET). Payload mínimo: userId + exp.
 * Sem lib de auth externa — 1 admin.
 */

const COOKIE_NAME = 'wpp_session';
const MAX_AGE_S = 8 * 60 * 60; // 8h

interface SessionPayload {
  userId: string;
  exp: number; // epoch segundos
}

function secret(): string {
  if (!env.PANEL_SESSION_SECRET) {
    throw new Error('PANEL_SESSION_SECRET não configurado (openssl rand -hex 32)');
  }
  return env.PANEL_SESSION_SECRET;
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

function encode(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function decode(token: string): SessionPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  if (expected.length !== sig.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Grava a sessão no cookie (chamado após login válido). */
export async function createSession(userId: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const token = encode({ userId, exp });
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: MAX_AGE_S,
  });
}

/** Lê a sessão atual, ou null. */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  return token ? decode(token) : null;
}

/** Remove a sessão (logout). */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export { COOKIE_NAME };

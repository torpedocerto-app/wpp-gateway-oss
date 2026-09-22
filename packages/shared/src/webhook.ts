import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Assinatura e verificação de webhooks (doc 03 §4.1).
 *
 * Assinatura: HMAC-SHA256(webhook_secret, "{timestamp}.{body_raw}")
 * Headers: X-Wpp-Signature, X-Wpp-Timestamp, X-Wpp-Event, X-Wpp-Delivery
 */

export const WEBHOOK_HEADERS = {
  SIGNATURE: 'x-wpp-signature',
  TIMESTAMP: 'x-wpp-timestamp',
  EVENT: 'x-wpp-event',
  DELIVERY: 'x-wpp-delivery',
} as const;

/** Janela de tolerância para replay (doc 03 §4.1). */
export const WEBHOOK_MAX_SKEW_SECONDS = 300;

/** Calcula a assinatura de um payload. `timestamp` em epoch segundos. */
export function signWebhook(secret: string, timestamp: number, bodyRaw: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${bodyRaw}`).digest('hex');
  return `sha256=${mac}`;
}

export interface WebhookHeaders {
  signature: string;
  timestamp: string;
  event: string;
  delivery: string;
}

/** Monta os 4 headers de um webhook. */
export function buildWebhookHeaders(
  secret: string,
  event: string,
  deliveryId: string,
  bodyRaw: string,
  now = Math.floor(Date.now() / 1000),
): WebhookHeaders {
  return {
    signature: signWebhook(secret, now, bodyRaw),
    timestamp: String(now),
    event,
    delivery: deliveryId,
  };
}

export type WebhookVerifyResult =
  | { valid: true }
  | { valid: false; reason: 'bad_timestamp' | 'stale' | 'bad_signature' };

/**
 * Verifica um webhook recebido (lado do CONSUMIDOR — incluído aqui para os
 * projetos da holding reusarem e para os testes).
 */
export function verifyWebhook(
  secret: string,
  headers: { signature?: string; timestamp?: string },
  bodyRaw: string,
  now = Math.floor(Date.now() / 1000),
): WebhookVerifyResult {
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return { valid: false, reason: 'bad_timestamp' };
  if (Math.abs(now - ts) > WEBHOOK_MAX_SKEW_SECONDS) return { valid: false, reason: 'stale' };

  const expected = signWebhook(secret, ts, bodyRaw);
  const got = headers.signature ?? '';
  if (expected.length !== got.length) return { valid: false, reason: 'bad_signature' };

  const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(got));
  return ok ? { valid: true } : { valid: false, reason: 'bad_signature' };
}

/** Backoff de retry de webhook em ms por tentativa já feita, 0-based (doc 03 §4.4). */
export const WEBHOOK_RETRY_DELAYS_MS = [
  0, // 1ª: imediato
  30_000, // 2ª: 30s
  120_000, // 3ª: 2min
  600_000, // 4ª: 10min
  3_600_000, // 5ª: 1h
  21_600_000, // 6ª: 6h
] as const;

export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length;

/** Delay da próxima tentativa; null se esgotou. */
export function webhookRetryDelayMs(attemptsMade: number): number | null {
  return WEBHOOK_RETRY_DELAYS_MS[attemptsMade] ?? null;
}

/** `true` se um status HTTP de resposta deve disparar retry (doc 03 §4.4). */
export function shouldRetryWebhook(httpStatus: number): boolean {
  if (httpStatus >= 200 && httpStatus < 300) return false; // sucesso
  if (httpStatus === 429) return true; // rate limited: retenta
  if (httpStatus >= 400 && httpStatus < 500) return false; // erro de config do consumidor
  return true; // 5xx, timeout (0), etc
}

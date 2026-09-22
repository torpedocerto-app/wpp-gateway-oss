import { describe, expect, it } from 'vitest';
import {
  signWebhook,
  verifyWebhook,
  buildWebhookHeaders,
  webhookRetryDelayMs,
  shouldRetryWebhook,
  WEBHOOK_MAX_ATTEMPTS,
} from './webhook.js';

const SECRET = 'whsec_teste_1234567890';

describe('signWebhook / verifyWebhook (doc 03 §4.1)', () => {
  it('assinatura verifica com o mesmo secret, timestamp e corpo', () => {
    const ts = 1_757_251_925;
    const body = '{"event":"message.received"}';
    const sig = signWebhook(SECRET, ts, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);

    const r = verifyWebhook(SECRET, { signature: sig, timestamp: String(ts) }, body, ts);
    expect(r).toEqual({ valid: true });
  });

  it('rejeita corpo adulterado', () => {
    const ts = 1_757_251_925;
    const sig = signWebhook(SECRET, ts, 'original');
    const r = verifyWebhook(SECRET, { signature: sig, timestamp: String(ts) }, 'adulterado', ts);
    expect(r).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('rejeita secret errado', () => {
    const ts = 1_757_251_925;
    const body = 'x';
    const sig = signWebhook(SECRET, ts, body);
    const r = verifyWebhook('outro_secret', { signature: sig, timestamp: String(ts) }, body, ts);
    expect(r).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('rejeita timestamp com mais de 5 min (replay)', () => {
    const ts = 1_757_251_925;
    const body = 'x';
    const sig = signWebhook(SECRET, ts, body);
    const now = ts + 400; // 6min40s depois
    const r = verifyWebhook(SECRET, { signature: sig, timestamp: String(ts) }, body, now);
    expect(r).toEqual({ valid: false, reason: 'stale' });
  });

  it('rejeita timestamp não numérico', () => {
    const r = verifyWebhook(SECRET, { signature: 'sha256=x', timestamp: 'ontem' }, 'x');
    expect(r).toEqual({ valid: false, reason: 'bad_timestamp' });
  });
});

describe('buildWebhookHeaders', () => {
  it('monta os 4 campos', () => {
    const h = buildWebhookHeaders(SECRET, 'message.status', 'deliv-1', '{}', 1_757_251_925);
    expect(h.event).toBe('message.status');
    expect(h.delivery).toBe('deliv-1');
    expect(h.timestamp).toBe('1757251925');
    expect(h.signature).toMatch(/^sha256=/);
  });
});

describe('retry de webhook (doc 03 §4.4)', () => {
  it('sequência de delays: 0, 30s, 2min, 10min, 1h, 6h', () => {
    expect(webhookRetryDelayMs(0)).toBe(0);
    expect(webhookRetryDelayMs(1)).toBe(30_000);
    expect(webhookRetryDelayMs(2)).toBe(120_000);
    expect(webhookRetryDelayMs(3)).toBe(600_000);
    expect(webhookRetryDelayMs(4)).toBe(3_600_000);
    expect(webhookRetryDelayMs(5)).toBe(21_600_000);
  });

  it('após 6 tentativas, esgota (null)', () => {
    expect(webhookRetryDelayMs(WEBHOOK_MAX_ATTEMPTS)).toBeNull();
    expect(webhookRetryDelayMs(10)).toBeNull();
  });

  it('shouldRetryWebhook: 2xx não, 4xx não (exceto 429), 5xx sim, 0 sim', () => {
    expect(shouldRetryWebhook(200)).toBe(false);
    expect(shouldRetryWebhook(204)).toBe(false);
    expect(shouldRetryWebhook(400)).toBe(false);
    expect(shouldRetryWebhook(404)).toBe(false);
    expect(shouldRetryWebhook(429)).toBe(true);
    expect(shouldRetryWebhook(500)).toBe(true);
    expect(shouldRetryWebhook(503)).toBe(true);
    expect(shouldRetryWebhook(0)).toBe(true); // timeout
  });
});

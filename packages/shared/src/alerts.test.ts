import { describe, expect, it } from 'vitest';
import {
  ALERT_RULES,
  AlertType,
  AlertChannel,
  AlertSeverity,
  alertDedupKey,
  isWithinDedupWindow,
  evaluateAccountHealth,
} from './alerts.js';

describe('ALERT_RULES (doc 04 §6.3)', () => {
  it('conta banida → CRÍTICO, WhatsApp+Email+Painel', () => {
    const r = ALERT_RULES[AlertType.ACCOUNT_BANNED];
    expect(r.severity).toBe(AlertSeverity.CRITICAL);
    expect(r.channels).toEqual([AlertChannel.WHATSAPP, AlertChannel.EMAIL, AlertChannel.PANEL]);
  });

  it('pool vazio → NÃO usa WhatsApp (0 contas), escala a cada 30min', () => {
    const r = ALERT_RULES[AlertType.POOL_EMPTY];
    expect(r.channels).not.toContain(AlertChannel.WHATSAPP);
    expect(r.channels).toContain(AlertChannel.EMAIL);
    expect(r.escalate).toBe(true);
    expect(r.escalateIntervalMs).toBe(30 * 60_000);
  });

  it('limite diário atingido → só painel, INFO', () => {
    const r = ALERT_RULES[AlertType.ACCOUNT_LIMIT_REACHED];
    expect(r.severity).toBe(AlertSeverity.INFO);
    expect(r.channels).toEqual([AlertChannel.PANEL]);
  });
});

describe('dedup (doc 04 §6.4)', () => {
  it('chave inclui tipo e entidade', () => {
    expect(alertDedupKey(AlertType.ACCOUNT_BANNED, 'acc-1')).toBe('alert:sent:ACCOUNT_BANNED:acc-1');
    expect(alertDedupKey(AlertType.POOL_EMPTY, null)).toBe('alert:sent:POOL_EMPTY:global');
  });

  it('sem envio anterior → não suprime', () => {
    expect(isWithinDedupWindow(AlertType.ACCOUNT_BANNED, null)).toBe(false);
  });

  it('dentro de 1h → suprime; após 1h → libera', () => {
    const now = 10_000_000_000;
    expect(isWithinDedupWindow(AlertType.ACCOUNT_BANNED, now - 59 * 60_000, now)).toBe(true);
    expect(isWithinDedupWindow(AlertType.ACCOUNT_BANNED, now - 61 * 60_000, now)).toBe(false);
  });

  it('pool vazio: janela de 30min', () => {
    const now = 10_000_000_000;
    expect(isWithinDedupWindow(AlertType.POOL_EMPTY, now - 29 * 60_000, now)).toBe(true);
    expect(isWithinDedupWindow(AlertType.POOL_EMPTY, now - 31 * 60_000, now)).toBe(false);
  });
});

describe('evaluateAccountHealth (doc 04 §4)', () => {
  it('conta saudável → não quarentena', () => {
    expect(
      evaluateAccountHealth({ consecutiveFailures: 1, recentDeliveryRate: 0.95, sentWithoutAck: 0 }),
    ).toEqual({ quarantine: false });
  });

  it('5 falhas consecutivas → quarentena 30min', () => {
    const d = evaluateAccountHealth({
      consecutiveFailures: 5,
      recentDeliveryRate: null,
      sentWithoutAck: 0,
    });
    expect(d).toMatchObject({ quarantine: true, durationMs: 30 * 60_000 });
  });

  it('taxa de entrega < 20% → quarentena 1h', () => {
    const d = evaluateAccountHealth({
      consecutiveFailures: 0,
      recentDeliveryRate: 0.1,
      sentWithoutAck: 0,
    });
    expect(d).toMatchObject({ quarantine: true, durationMs: 60 * 60_000 });
  });

  it('10 envios sem ack → quarentena', () => {
    const d = evaluateAccountHealth({
      consecutiveFailures: 0,
      recentDeliveryRate: null,
      sentWithoutAck: 10,
    });
    expect(d).toMatchObject({ quarantine: true });
  });

  it('taxa null (poucas mensagens) não dispara sozinha', () => {
    expect(
      evaluateAccountHealth({ consecutiveFailures: 2, recentDeliveryRate: null, sentWithoutAck: 3 }),
    ).toEqual({ quarantine: false });
  });
});

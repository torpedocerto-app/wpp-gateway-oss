import { describe, expect, it } from 'vitest';
import {
  classifyDisconnect,
  DisconnectDecision,
  reconnectDelayMs,
  RECONNECT_BACKOFF_CEILING_MS,
} from './disconnect.js';

describe('classifyDisconnect (doc 04 §3)', () => {
  it('loggedOut (401) → BANNED, apaga credenciais, alerta', () => {
    const c = classifyDisconnect(401);
    expect(c.decision).toBe(DisconnectDecision.BANNED);
    expect(c.wipeCredentials).toBe(true);
    expect(c.alert).toBe(true);
  });

  it('forbidden (403) → BANNED', () => {
    expect(classifyDisconnect(403).decision).toBe(DisconnectDecision.BANNED);
  });

  it('badSession (500) → backoff, NÃO apaga credenciais, NÃO alerta (não é ban)', () => {
    const c = classifyDisconnect(500);
    expect(c.decision).toBe(DisconnectDecision.RECONNECT_BACKOFF);
    expect(c.wipeCredentials).toBe(false);
    expect(c.alert).toBe(false);
  });

  it('connectionReplaced (440) → REPLACED, NÃO apaga credenciais, alerta', () => {
    const c = classifyDisconnect(440);
    expect(c.decision).toBe(DisconnectDecision.REPLACED);
    expect(c.wipeCredentials).toBe(false);
    expect(c.alert).toBe(true);
  });

  it('restartRequired (515) → reconecta já, sem alerta', () => {
    const c = classifyDisconnect(515);
    expect(c.decision).toBe(DisconnectDecision.RECONNECT_NOW);
    expect(c.alert).toBe(false);
  });

  it('connectionLost (408) → reconecta com backoff', () => {
    expect(classifyDisconnect(408).decision).toBe(DisconnectDecision.RECONNECT_BACKOFF);
  });

  it('código desconhecido → backoff, sem apagar nada', () => {
    const c = classifyDisconnect(999);
    expect(c.decision).toBe(DisconnectDecision.RECONNECT_BACKOFF);
    expect(c.wipeCredentials).toBe(false);
    expect(c.reason).toContain('999');
  });

  it('sem código → backoff', () => {
    expect(classifyDisconnect(undefined).decision).toBe(DisconnectDecision.RECONNECT_BACKOFF);
  });
});

describe('reconnectDelayMs (doc 04 §3.1)', () => {
  it('progride 5s → 15s → 45s → 2min → 5min', () => {
    expect(reconnectDelayMs(0)).toBe(5_000);
    expect(reconnectDelayMs(1)).toBe(15_000);
    expect(reconnectDelayMs(2)).toBe(45_000);
    expect(reconnectDelayMs(3)).toBe(120_000);
    expect(reconnectDelayMs(4)).toBe(300_000);
  });

  it('a partir da 6ª tentativa fica no teto de 15 min', () => {
    expect(reconnectDelayMs(5)).toBe(RECONNECT_BACKOFF_CEILING_MS);
    expect(reconnectDelayMs(20)).toBe(RECONNECT_BACKOFF_CEILING_MS);
  });
});

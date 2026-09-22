import { describe, expect, it } from 'vitest';
import {
  generateToken,
  hashToken,
  safeEqualHex,
  isExpired,
  RESET_TTL_MS,
  INVITE_TTL_MS,
} from './tokens.js';

describe('generateToken / hashToken', () => {
  it('gera raw base64url e hash sha256 hex de 64 chars', () => {
    const { raw, hash } = generateToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(raw.length).toBeGreaterThanOrEqual(43); // 32 bytes em base64url
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(raw)).toBe(hash);
  });

  it('cada chamada gera um token diferente', () => {
    expect(generateToken().raw).not.toBe(generateToken().raw);
  });
});

describe('safeEqualHex', () => {
  it('true para hashes iguais, false para diferentes ou tamanhos distintos', () => {
    const h = hashToken('abc');
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hashToken('abd'))).toBe(false);
    expect(safeEqualHex(h, 'deadbeef')).toBe(false);
  });
});

describe('isExpired', () => {
  it('compara com o instante dado', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    expect(isExpired(new Date('2026-01-01T11:59:59Z'), now)).toBe(true);
    expect(isExpired(new Date('2026-01-01T12:00:01Z'), now)).toBe(false);
  });
});

describe('TTLs', () => {
  it('RESET 30 min, INVITE 72 h', () => {
    expect(RESET_TTL_MS).toBe(30 * 60 * 1000);
    expect(INVITE_TTL_MS).toBe(72 * 60 * 60 * 1000);
  });
});

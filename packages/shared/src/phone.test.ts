import { describe, expect, it } from 'vitest';
import { normalizePhone, tryNormalizePhone } from './phone.js';

describe('normalizePhone (doc 03 §5)', () => {
  it('celular BR sem código de país (11 dígitos com DDD)', () => {
    expect(normalizePhone('11999998888').e164).toBe('+5511999998888');
  });

  it('celular BR com máscara', () => {
    expect(normalizePhone('(11) 99999-8888').e164).toBe('+5511999998888');
  });

  it('celular BR já com código do país, sem +', () => {
    expect(normalizePhone('5511999998888').e164).toBe('+5511999998888');
  });

  it('celular BR com + e espaços', () => {
    expect(normalizePhone('+55 11 99999-8888').e164).toBe('+5511999998888');
  });

  it('número internacional sem + (Colômbia, código 57)', () => {
    const n = normalizePhone('573001234568');
    expect(n.e164).toBe('+573001234568');
    expect(n.country).toBe('CO');
  });

  it('número internacional com + (Portugal)', () => {
    const n = normalizePhone('+351912345678');
    expect(n.e164).toBe('+351912345678');
    expect(n.country).toBe('PT');
  });

  it('rejeita número curto demais', () => {
    expect(() => normalizePhone('119')).toThrow(/inválido/);
  });

  it('rejeita string sem dígitos suficientes', () => {
    expect(() => normalizePhone('abc')).toThrow();
  });

  it('tryNormalizePhone devolve null em vez de lançar', () => {
    expect(tryNormalizePhone('119')).toBeNull();
    expect(tryNormalizePhone('11999998888')).not.toBeNull();
  });
});

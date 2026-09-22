import { describe, expect, it } from 'vitest';
import {
  composingDurationMs,
  computeSendDelayMs,
  isSilentHour,
  silentHourDelayMs,
} from './humanize.js';

describe('computeSendDelayMs (doc 05 §5)', () => {
  it('sem pausa longa, fica na faixa base ±30% (~5.6s a ~32.5s)', () => {
    // rng fixo em 0.5 → base ~16.5s, jitter 0
    const d = computeSendDelayMs(() => 0.5);
    expect(d).toBeGreaterThan(15_000);
    expect(d).toBeLessThan(18_000);
  });

  it('rng baixo aciona a pausa longa (5% de chance)', () => {
    // primeira chamada 0.01 (< 0.05) dispara pausa; resto 0.01
    const seq = [0.01, 0.01, 0.01, 0.01];
    let i = 0;
    const d = computeSendDelayMs(() => seq[i++ % seq.length]!);
    expect(d).toBeGreaterThan(60_000);
  });

  it('nunca retorna menos de 1s', () => {
    for (let i = 0; i < 100; i++) {
      expect(computeSendDelayMs()).toBeGreaterThanOrEqual(1_000);
    }
  });
});

describe('composingDurationMs', () => {
  it('proporcional ao tamanho: ~1s a cada 12 chars', () => {
    expect(composingDurationMs(60)).toBe(5_000);
  });
  it('teto de 8s', () => {
    expect(composingDurationMs(500)).toBe(8_000);
  });
});

describe('isSilentHour (janela cruzando meia-noite 23→6)', () => {
  it('23h, 0h, 3h, 5h estão na janela', () => {
    for (const h of [23, 0, 3, 5]) expect(isSilentHour(h)).toBe(true);
  });
  it('6h, 12h, 22h estão fora', () => {
    for (const h of [6, 12, 22]) expect(isSilentHour(h)).toBe(false);
  });
  it('janela start==end nunca silencia', () => {
    expect(isSilentHour(3, { silentStart: 5, silentEnd: 5 })).toBe(false);
  });
});

describe('silentHourDelayMs (fuso UTC — equivalente ao timezone único de antes)', () => {
  it('mensagem urgente nunca é adiada', () => {
    const madrugada = new Date('2026-09-07T02:00:00Z');
    expect(silentHourDelayMs(madrugada, true, 'UTC')).toBe(0);
  });

  it('fora da janela, delay é 0', () => {
    const tarde = new Date('2026-09-07T15:00:00Z');
    expect(silentHourDelayMs(tarde, false, 'UTC')).toBe(0);
  });

  it('às 2h, adia até as 6h (~4h)', () => {
    const duasDaManha = new Date('2026-09-07T02:00:00Z');
    const delay = silentHourDelayMs(duasDaManha, false, 'UTC');
    expect(delay).toBeGreaterThan(3.9 * 3600_000);
    expect(delay).toBeLessThan(4.1 * 3600_000);
  });

  it('às 23h30, adia até as 6h do dia seguinte (~6.5h)', () => {
    const quaseMeiaNoite = new Date('2026-09-07T23:30:00Z');
    const delay = silentHourDelayMs(quaseMeiaNoite, false, 'UTC');
    expect(delay).toBeGreaterThan(6.4 * 3600_000);
    expect(delay).toBeLessThan(6.6 * 3600_000);
  });

  it('respeita o fuso do tenant: 21h em Bogotá (02h UTC) ainda não é silêncio', () => {
    // 2026-09-07T02:00:00Z = 21h de 06/09 em Bogotá (UTC-5) — fora da janela 23-6
    const d = new Date('2026-09-07T02:00:00Z');
    expect(silentHourDelayMs(d, false, 'America/Bogota')).toBe(0);
  });

  it('respeita o fuso do tenant: 04h em Bogotá (09h UTC) está em silêncio', () => {
    // 2026-09-07T09:00:00Z = 04h em Bogotá (UTC-5) — dentro da janela 23-6
    const d = new Date('2026-09-07T09:00:00Z');
    const delay = silentHourDelayMs(d, false, 'America/Bogota');
    expect(delay).toBeGreaterThan(1.9 * 3600_000);
    expect(delay).toBeLessThan(2.1 * 3600_000); // até as 6h locais (~2h depois)
  });
});

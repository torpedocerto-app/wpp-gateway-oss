import { describe, expect, it } from 'vitest';
import {
  localHour,
  localDayKey,
  localHourKey,
  nextLocalMidnightUtc,
  secondsUntilNextLocalMidnight,
  startOfLocalDayUtc,
  startOfLocalHourUtc,
} from './tenant-tz.js';

describe('localHour', () => {
  it('UTC 03:00 é 22h da véspera em Bogotá (UTC-5)', () => {
    const d = new Date('2026-03-10T03:00:00Z');
    expect(localHour(d, 'America/Bogota')).toBe(22);
  });

  it('UTC 03:00 é meia-noite em São Paulo (UTC-3)', () => {
    const d = new Date('2026-03-10T03:00:00Z');
    expect(localHour(d, 'America/Sao_Paulo')).toBe(0);
  });

  it('UTC continua UTC', () => {
    const d = new Date('2026-03-10T14:30:00Z');
    expect(localHour(d, 'UTC')).toBe(14);
  });
});

describe('localDayKey / localHourKey', () => {
  it('vira o dia local antes do dia UTC quando o fuso está atrás', () => {
    // 03:00 UTC de 10/mar ainda é 22h de 9/mar em Bogotá
    const d = new Date('2026-03-10T03:00:00Z');
    expect(localDayKey(d, 'America/Bogota')).toBe('20260309');
    expect(localDayKey(d, 'UTC')).toBe('20260310');
  });

  it('localHourKey inclui a hora local', () => {
    const d = new Date('2026-03-10T03:00:00Z');
    expect(localHourKey(d, 'America/Bogota')).toBe('2026030922');
  });
});

describe('nextLocalMidnightUtc / secondsUntilNextLocalMidnight', () => {
  it('Bogotá: meia-noite local (05:00 UTC) a partir de qualquer hora do mesmo dia local', () => {
    const now = new Date('2026-03-10T03:00:00Z'); // 22h de 9/mar em Bogotá
    const midnight = nextLocalMidnightUtc(now, 'America/Bogota');
    expect(midnight.toISOString()).toBe('2026-03-10T05:00:00.000Z'); // 00:00 de 10/mar em Bogotá
  });

  it('secondsUntilNextLocalMidnight é positivo e bate com a diferença', () => {
    const now = new Date('2026-03-10T03:00:00Z');
    const s = secondsUntilNextLocalMidnight(now, 'America/Bogota');
    expect(s).toBe(2 * 3600); // 22h → 00h = 2h
  });

  it('UTC: meia-noite local é meia-noite UTC', () => {
    const now = new Date('2026-03-10T14:00:00Z');
    const midnight = nextLocalMidnightUtc(now, 'UTC');
    expect(midnight.toISOString()).toBe('2026-03-11T00:00:00.000Z');
  });
});

describe('startOfLocalDayUtc', () => {
  it('Bogotá: início do dia local (05:00 UTC) para um instante depois no mesmo dia local', () => {
    // 22h de 9/mar em Bogotá = 03:00 UTC de 10/mar; início do dia (00h de 9/mar) = 05:00 UTC de 9/mar
    const now = new Date('2026-03-10T03:00:00Z');
    expect(startOfLocalDayUtc(now, 'America/Bogota').toISOString()).toBe(
      '2026-03-09T05:00:00.000Z',
    );
  });

  it('UTC: início do dia é meia-noite UTC do mesmo dia', () => {
    const now = new Date('2026-03-10T14:00:00Z');
    expect(startOfLocalDayUtc(now, 'UTC').toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });
});

describe('startOfLocalHourUtc', () => {
  it('Bogotá: início da hora local', () => {
    const now = new Date('2026-03-10T03:45:00Z'); // 22h45 em Bogotá
    expect(startOfLocalHourUtc(now, 'America/Bogota').toISOString()).toBe(
      '2026-03-10T03:00:00.000Z',
    );
  });

  it('UTC: início da hora é a própria hora zerada', () => {
    const now = new Date('2026-03-10T14:37:00Z');
    expect(startOfLocalHourUtc(now, 'UTC').toISOString()).toBe('2026-03-10T14:00:00.000Z');
  });
});

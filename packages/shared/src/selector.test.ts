import { describe, expect, it } from 'vitest';
import {
  type AccountSnapshot,
  accountWeight,
  ineligibleReason,
  selectAccount,
} from './selector.js';

function baseAccount(over: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    id: 'a',
    status: 'CONNECTED',
    isEnabled: true,
    socketOpen: true,
    priority: 0,
    dailyLimit: 300,
    hourlyLimit: 40,
    sentToday: 0,
    sentThisHour: 0,
    lastSendAt: null,
    recentDeliveryRate: null,
    inWarmup: false,
    quarantined: false,
    locked: false,
    inCooldown: false,
    ...over,
  };
}

describe('ineligibleReason (doc 05 §2.1)', () => {
  it('conta saudável é elegível', () => {
    expect(ineligibleReason(baseAccount())).toBeNull();
  });

  it('exclui conta não conectada', () => {
    expect(ineligibleReason(baseAccount({ status: 'RECONNECTING' }))).toBe('not_connected');
  });

  it('exclui conta desabilitada', () => {
    expect(ineligibleReason(baseAccount({ isEnabled: false }))).toBe('disabled');
  });

  it('exclui conta com socket fechado', () => {
    expect(ineligibleReason(baseAccount({ socketOpen: false }))).toBe('socket_closed');
  });

  it('exclui conta no limite horário', () => {
    expect(ineligibleReason(baseAccount({ sentThisHour: 40, hourlyLimit: 40 }))).toBe(
      'hourly_limit',
    );
  });

  it('exclui conta no limite diário', () => {
    expect(ineligibleReason(baseAccount({ sentToday: 300, dailyLimit: 300 }))).toBe('daily_limit');
  });

  it('exclui conta em quarentena, cooldown ou com lock', () => {
    expect(ineligibleReason(baseAccount({ quarantined: true }))).toBe('quarantined');
    expect(ineligibleReason(baseAccount({ inCooldown: true }))).toBe('cooldown');
    expect(ineligibleReason(baseAccount({ locked: true }))).toBe('locked');
  });
});

describe('accountWeight (doc 05 §2.2)', () => {
  it('conta em warmup pesa ~30% de uma conta madura equivalente', () => {
    const madura = accountWeight(baseAccount({ lastSendAt: null }));
    const warmup = accountWeight(baseAccount({ inWarmup: true, lastSendAt: null }));
    expect(warmup / madura).toBeCloseTo(0.3, 1);
  });

  it('conta quase no limite diário pesa muito menos', () => {
    const folgada = accountWeight(baseAccount({ sentToday: 0 }));
    const cheia = accountWeight(baseAccount({ sentToday: 297, dailyLimit: 300 }));
    expect(cheia).toBeLessThan(folgada * 0.05);
  });

  it('entrega recente ruim reduz o peso, com piso em 0.1', () => {
    const boa = accountWeight(baseAccount({ recentDeliveryRate: 1 }));
    const ruim = accountWeight(baseAccount({ recentDeliveryRate: 0 }));
    expect(ruim).toBeCloseTo(boa * 0.1, 5);
  });

  it('recém-enviou pesa menos que descansada', () => {
    const now = 1_000_000_000_000;
    const descansada = accountWeight(baseAccount({ lastSendAt: now - 300_000 }), now);
    const recente = accountWeight(baseAccount({ lastSendAt: now - 10_000 }), now);
    expect(recente).toBeLessThan(descansada);
  });
});

describe('selectAccount', () => {
  it('retorna null se nenhuma conta é elegível', () => {
    expect(selectAccount([baseAccount({ status: 'BANNED' })])).toBeNull();
  });

  it('respeita preferredId quando elegível', () => {
    const accounts = [baseAccount({ id: 'x' }), baseAccount({ id: 'y' })];
    expect(selectAccount(accounts, { preferredId: 'y' })).toBe('y');
  });

  it('ignora preferredId inelegível e sorteia normalmente', () => {
    const accounts = [
      baseAccount({ id: 'x' }),
      baseAccount({ id: 'y', status: 'BANNED' }),
    ];
    expect(selectAccount(accounts, { preferredId: 'y' })).toBe('x');
  });

  it('exclui contas já tentadas (fallback)', () => {
    const accounts = [baseAccount({ id: 'x' }), baseAccount({ id: 'y' })];
    const picked = selectAccount(accounts, { excludeIds: ['x'], rng: () => 0 });
    expect(picked).toBe('y');
  });

  it('distribui entre contas ao longo de muitos sorteios (não é sempre a mesma)', () => {
    const accounts = [
      baseAccount({ id: 'a' }),
      baseAccount({ id: 'b' }),
      baseAccount({ id: 'c' }),
    ];
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    let seed = 42;
    const rng = () => {
      // LCG determinístico
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 3000; i++) {
      const id = selectAccount(accounts, { rng })!;
      counts[id]!++;
    }
    // cada conta deve receber entre 20% e 47% (longe de round-robin exato de 33%)
    for (const id of ['a', 'b', 'c']) {
      expect(counts[id]! / 3000).toBeGreaterThan(0.2);
      expect(counts[id]! / 3000).toBeLessThan(0.47);
    }
  });

  it('conta folgada é sorteada mais que conta quase cheia', () => {
    const accounts = [
      baseAccount({ id: 'folgada', sentToday: 0 }),
      baseAccount({ id: 'cheia', sentToday: 290, dailyLimit: 300 }),
    ];
    let seed = 7;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    let folgada = 0;
    for (let i = 0; i < 2000; i++) {
      if (selectAccount(accounts, { rng }) === 'folgada') folgada++;
    }
    expect(folgada / 2000).toBeGreaterThan(0.9);
  });
});

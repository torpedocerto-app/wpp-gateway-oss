import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { readCounters, incrCounters } from './counters.js';

/** Precisa do Redis do docker (`pnpm infra:up`). */
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
});

const ACCT = `test-counters-${Date.now()}`;

async function cleanup() {
  const keys = await redis.keys(`acct:${ACCT}:sent:*`);
  if (keys.length) await redis.del(...keys);
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  redis.disconnect();
});

describe('counters (fuso do tenant, doc 09 §4)', () => {
  it('incrementa e lê no mesmo fuso', async () => {
    const now = new Date('2026-03-10T15:00:00Z');
    await incrCounters(redis, ACCT, 'America/Bogota', now);
    const c = await readCounters(redis, ACCT, 'America/Bogota', now);
    expect(c.hour).toBe(1);
    expect(c.day).toBe(1);
  });

  it('a mesma conta lida com o fuso errado não vê o contador — prova que a chave é por fuso', async () => {
    // 02:00 UTC de 10/mar ainda é 21h de 9/mar em Bogotá (UTC-5) — dia local
    // diferente do dia UTC. Ler com o fuso certo acha; com outro fuso, não.
    const now = new Date('2026-03-10T02:00:00Z');
    const acct = `${ACCT}-cross`;
    try {
      await incrCounters(redis, acct, 'America/Bogota', now);

      const right = await readCounters(redis, acct, 'America/Bogota', now);
      expect(right.day).toBe(1);

      // UTC nesse instante ainda é 10/mar — chave de dia diferente da de Bogotá (9/mar)
      const wrongTz = await readCounters(redis, acct, 'UTC', now);
      expect(wrongTz.day).toBe(0);
    } finally {
      const keys = await redis.keys(`acct:${acct}:sent:*`);
      if (keys.length) await redis.del(...keys);
    }
  });
});

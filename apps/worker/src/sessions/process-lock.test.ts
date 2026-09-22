import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import {
  acquireSessionOwnership,
  currentSessionOwner,
} from './process-lock.js';

/** Precisa do Redis do docker (`pnpm infra:up`). */
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
});

const ACCT = `test-lock-${Date.now()}`;

beforeAll(async () => {
  await redis.del(`session:owner:${ACCT}`);
});

afterAll(async () => {
  await redis.del(`session:owner:${ACCT}`);
  await redis.quit();
});

describe('process-lock (conflito 440)', () => {
  it('primeiro processo adquire, segundo é recusado', async () => {
    const a = await acquireSessionOwnership(redis, ACCT);
    expect(a).not.toBeNull();

    const b = await acquireSessionOwnership(redis, ACCT);
    expect(b).toBeNull();

    const owner = await currentSessionOwner(redis, ACCT);
    expect(owner).toBe(a!.processId);

    await a!.release();
  });

  it('após release, outro processo consegue adquirir', async () => {
    const a = await acquireSessionOwnership(redis, ACCT);
    await a!.release();

    const b = await acquireSessionOwnership(redis, ACCT);
    expect(b).not.toBeNull();
    await b!.release();
  });

  it('renew mantém o lock; release de outro dono não afeta', async () => {
    const a = await acquireSessionOwnership(redis, ACCT);
    expect(await a!.renew()).toBe(true);

    // simula um "dono fantasma" tentando liberar
    const fake = { accountId: ACCT, processId: 'fake', renew: () => Promise.resolve(false), release: async () => {
      await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        `session:owner:${ACCT}`,
        'fake',
      );
    } };
    await fake.release();

    // o lock de `a` continua de pé
    expect(await currentSessionOwner(redis, ACCT)).toBe(a!.processId);
    await a!.release();
  });
});

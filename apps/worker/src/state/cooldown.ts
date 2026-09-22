import type { Redis } from 'ioredis';

/**
 * Cooldown por conta: o intervalo mínimo entre envios humanizados (doc 05 §5).
 * Depois de enviar, a conta fica em cooldown pelo delay calculado — durante
 * esse tempo ela sai do sorteio (doc 05 §2.1).
 *
 * Implementação: chave com TTL igual ao delay. Presença = em cooldown.
 */

function key(accountId: string): string {
  return `acct:${accountId}:cooldown`;
}

export async function setCooldown(
  redis: Redis,
  accountId: string,
  ms: number,
): Promise<void> {
  await redis.set(key(accountId), '1', 'PX', Math.max(1, Math.round(ms)));
}

export async function isInCooldown(redis: Redis, accountId: string): Promise<boolean> {
  return (await redis.exists(key(accountId))) === 1;
}

/** Quarentena por heurística de shadow-ban (doc 04 §4) — Fase 5 a preenche. */
export async function isQuarantined(redis: Redis, accountId: string): Promise<boolean> {
  return (await redis.exists(`acct:${accountId}:quarantine`)) === 1;
}

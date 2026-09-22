import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';

/**
 * Lock por conta (doc 05 §2.1): cada conta processa UMA mensagem por vez.
 * Sem isso, dois jobs paralelos enviariam simultaneamente pela mesma conta —
 * humanamente impossível e um sinal claro de automação.
 *
 * Implementação: `SET account:{id}:lock <token> NX EX 30`. O token evita que um
 * job libere o lock de outro (caso o primeiro tenha expirado e sido re-adquirido).
 */

const LOCK_TTL_S = 30;

export interface AccountLock {
  accountId: string;
  token: string;
}

/** Tenta adquirir o lock. Retorna o lock, ou null se já está tomado. */
export async function acquireAccountLock(
  redis: Redis,
  accountId: string,
): Promise<AccountLock | null> {
  const token = randomUUID();
  const res = await redis.set(`account:${accountId}:lock`, token, 'EX', LOCK_TTL_S, 'NX');
  return res === 'OK' ? { accountId, token } : null;
}

/** Libera o lock, só se ainda for nosso (compare-and-delete via Lua). */
export async function releaseAccountLock(redis: Redis, lock: AccountLock): Promise<void> {
  const lua = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end`;
  await redis.eval(lua, 1, `account:${lock.accountId}:lock`, lock.token);
}

/** Renova o TTL do lock (para envios que demoram mais que 30s com os delays). */
export async function renewAccountLock(redis: Redis, lock: AccountLock): Promise<boolean> {
  const lua = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("expire", KEYS[1], ARGV[2])
    else
      return 0
    end`;
  const res = await redis.eval(lua, 1, `account:${lock.accountId}:lock`, lock.token, LOCK_TTL_S);
  return res === 1;
}

/** True se a conta está com lock tomado (para o snapshot do sorteio). */
export async function isAccountLocked(redis: Redis, accountId: string): Promise<boolean> {
  const v = await redis.exists(`account:${accountId}:lock`);
  return v === 1;
}

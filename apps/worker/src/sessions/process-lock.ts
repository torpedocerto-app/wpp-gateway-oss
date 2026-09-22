import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Lock de PROCESSO por sessão WhatsApp.
 *
 * Diferente do lock de envio (state/lock.ts, que serializa mensagens numa
 * conta), este garante que apenas UM processo do worker (ou da CLI) tenha o
 * socket de uma conta aberto por vez. Dois sockets no mesmo número = o WhatsApp
 * derruba um com `conflict: replaced` (código 440), causando churn de
 * reconexão e falhas de entrega.
 *
 * Chave: `session:owner:{accountId}` → id do processo dono. TTL curto,
 * renovado por heartbeat enquanto a sessão está viva.
 */

const TTL_S = 45;
const RENEW_MS = 15_000;

export interface SessionOwnership {
  accountId: string;
  processId: string;
  renew: () => Promise<boolean>;
  release: () => Promise<void>;
}

/**
 * Tenta tornar-se dono da sessão. Retorna null se outro processo já é dono
 * (nesse caso NÃO abrir o socket — evita o conflito 440).
 */
export async function acquireSessionOwnership(
  redis: Redis,
  accountId: string,
): Promise<SessionOwnership | null> {
  const processId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  const key = `session:owner:${accountId}`;

  const ok = await redis.set(key, processId, 'EX', TTL_S, 'NX');
  if (ok !== 'OK') return null;

  let timer: NodeJS.Timeout | null = null;

  const renew = async (): Promise<boolean> => {
    const lua = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("expire", KEYS[1], ARGV[2])
      else
        return 0
      end`;
    const res = await redis.eval(lua, 1, key, processId, TTL_S);
    return res === 1;
  };

  const release = async (): Promise<void> => {
    if (timer) clearInterval(timer);
    const lua = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end`;
    await redis.eval(lua, 1, key, processId);
  };

  timer = setInterval(() => void renew(), RENEW_MS);
  timer.unref();

  return { accountId, processId, renew, release };
}

/** Quem é o dono atual da sessão, se houver. */
export async function currentSessionOwner(
  redis: Redis,
  accountId: string,
): Promise<string | null> {
  return redis.get(`session:owner:${accountId}`);
}

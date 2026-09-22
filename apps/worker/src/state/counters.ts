import type { Redis } from 'ioredis';
import { localDayKey, localHourKey } from '@wpp/shared';

/**
 * Contadores de envio por conta em Redis, com TTL (doc 05 §2.1).
 *
 * São contadores DERIVADOS: o Postgres (`messages`) é a verdade histórica.
 * Se o Redis reiniciar, os contadores zeram e o pior caso é uma conta enviar
 * um pouco além do limite até o próximo ciclo — aceitável e auto-corrige.
 *
 * As chaves usam a hora/dia LOCAL do tenant (`TENANT_TIMEZONE`, doc 09 §4),
 * não UTC — o limite diário/horário precisa virar à meia-noite/hora de
 * verdade do tenant (Bogotá, São Paulo, …), não do servidor.
 */

function hourKey(accountId: string, now: Date, timeZone: string): string {
  return `acct:${accountId}:sent:hour:${localHourKey(now, timeZone)}`;
}

function dayKey(accountId: string, now: Date, timeZone: string): string {
  return `acct:${accountId}:sent:day:${localDayKey(now, timeZone)}`;
}

const HOUR_TTL_S = 3900; // 65 min — cobre a hora com folga
const DAY_TTL_S = 90_000; // ~25 h

/** Lê os contadores atuais (hora e dia) de uma conta. */
export async function readCounters(
  redis: Redis,
  accountId: string,
  timeZone: string,
  now = new Date(),
): Promise<{ hour: number; day: number }> {
  const [h, d] = await redis.mget(hourKey(accountId, now, timeZone), dayKey(accountId, now, timeZone));
  return { hour: Number(h ?? 0), day: Number(d ?? 0) };
}

/** Incrementa ambos os contadores após um envio bem-sucedido. */
export async function incrCounters(
  redis: Redis,
  accountId: string,
  timeZone: string,
  now = new Date(),
): Promise<void> {
  const hk = hourKey(accountId, now, timeZone);
  const dk = dayKey(accountId, now, timeZone);
  await redis
    .multi()
    .incr(hk)
    .expire(hk, HOUR_TTL_S)
    .incr(dk)
    .expire(dk, DAY_TTL_S)
    .exec();
}

/** Marca o instante do último envio da conta (para o fator_descanso do sorteio). */
export async function markLastSend(
  redis: Redis,
  accountId: string,
  now = Date.now(),
): Promise<void> {
  await redis.set(`acct:${accountId}:lastsend`, now, 'EX', 3600);
}

export async function readLastSend(redis: Redis, accountId: string): Promise<number | null> {
  const v = await redis.get(`acct:${accountId}:lastsend`);
  return v === null ? null : Number(v);
}

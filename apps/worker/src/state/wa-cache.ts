import type { Redis } from 'ioredis';

/**
 * Cache do resultado de `onWhatsApp()` (doc 05 §3.2), TTL 7 dias.
 *
 * Além de economizar round-trips, evita consultar o WhatsApp repetidamente pelo
 * mesmo número — a própria consulta é um sinal de comportamento automatizado.
 *
 * Guarda três estados: 'yes' (existe), 'no' (não existe), ou ausente (nunca
 * consultado). Só 'no' bloqueia o envio; 'yes' e ausente seguem para o envio
 * (ausente será resolvido e cacheado no caminho).
 */

const TTL_S = 7 * 24 * 3600;

function key(phone: string): string {
  return `wa:exists:${phone.replace(/\D/g, '')}`;
}

export type WaExistence = 'yes' | 'no' | 'unknown';

export async function getWaExistence(redis: Redis, phone: string): Promise<WaExistence> {
  const v = await redis.get(key(phone));
  if (v === 'yes') return 'yes';
  if (v === 'no') return 'no';
  return 'unknown';
}

export async function setWaExistence(
  redis: Redis,
  phone: string,
  exists: boolean,
): Promise<void> {
  await redis.set(key(phone), exists ? 'yes' : 'no', 'EX', TTL_S);
}

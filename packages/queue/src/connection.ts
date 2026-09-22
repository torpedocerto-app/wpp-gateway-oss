import { Redis } from 'ioredis';
import { loadEnv } from '@wpp/config';

const env = loadEnv();

/**
 * Conexões Redis para o BullMQ.
 *
 * BullMQ exige `maxRetriesPerRequest: null` nas conexões que usa para blocking
 * commands (Worker, QueueEvents). A `Queue` (só produz jobs) pode usar uma
 * conexão normal, mas mantemos o mesmo padrão por simplicidade.
 */
export function makeQueueConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

/** Conexão de estado (cache, contadores, locks) — retry normal. */
export function makeStateConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
}

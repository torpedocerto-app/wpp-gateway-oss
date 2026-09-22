import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { ApiError } from '@wpp/shared';

/**
 * Rate limiting por token (doc 03 §6), implementação manual.
 *
 * O @fastify/rate-limit resolve `max` no ciclo onRequest, antes do nosso
 * preHandler de auth — então não enxerga o limite do projeto. Aqui rodamos
 * DEPOIS da auth, como um segundo preHandler, com `req.auth` já preenchido.
 *
 * Algoritmo: contador fixo por janela de 60s. `INCR` + `EXPIRE` no primeiro hit.
 * Headers X-RateLimit-* conforme o doc.
 */
export function makeRateLimitPreHandler(redis: Redis) {
  return async function rateLimitPreHandler(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const limit = req.auth?.rateLimitPerMinute ?? 60;
    const tokenId = req.auth?.apiTokenId ?? req.ip;

    const windowStart = Math.floor(Date.now() / 60_000);
    const key = `ratelimit:${tokenId}:${windowStart}`;

    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 65);
    }

    const remaining = Math.max(0, limit - count);
    const resetAt = (windowStart + 1) * 60; // epoch seconds

    reply.header('x-ratelimit-limit', String(limit));
    reply.header('x-ratelimit-remaining', String(remaining));
    reply.header('x-ratelimit-reset', String(resetAt));

    if (count > limit) {
      const retryAfter = resetAt - Math.floor(Date.now() / 1000);
      reply.header('retry-after', String(Math.max(1, retryAfter)));
      throw new ApiError('RATE_LIMIT_EXCEEDED');
    }
  };
}

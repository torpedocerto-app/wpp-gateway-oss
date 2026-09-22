import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import multipart from '@fastify/multipart';
import { ApiError, MEDIA_LIMITS } from '@wpp/shared';
import { redis } from './redis.js';
import { makeAuthPreHandler } from './auth.js';
import { makeRateLimitPreHandler } from './rate-limit.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerHealthRoute } from './routes/health.js';
import { registerWebhookRoutes } from './routes/webhook.js';

/**
 * Monta a instância Fastify da API pública (doc 03).
 * Exportada separada do `main.ts` para os testes usarem `app.inject()`.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      ...(process.env.NODE_ENV !== 'production'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
    },
    trustProxy: true,
  });

  // ── Error handler: ApiError → corpo padrão (doc 03 §7) ────────────────────
  app.setErrorHandler((err: FastifyError | ApiError, req, reply) => {
    if (err instanceof ApiError) {
      void reply.code(err.http).send(err.toBody());
      return;
    }
    // @fastify/multipart estoura o limite de tamanho dentro do próprio hook de
    // parsing (attachFieldsToBody consome o arquivo em preValidation) — chega
    // aqui como FastifyError, não dá pra capturar com try/catch na rota.
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      const apiErr = new ApiError('MEDIA_TOO_LARGE');
      void reply.code(apiErr.http).send(apiErr.toBody());
      return;
    }
    if (err.validation) {
      void reply.code(422).send({ error: { code: 'INVALID_PHONE_NUMBER', message: err.message } });
      return;
    }
    req.log.error({ err }, 'erro não tratado');
    void reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
  });

  app.setNotFoundHandler((_req, reply) => {
    void reply
      .code(404)
      .send({ error: { code: 'MESSAGE_NOT_FOUND', message: 'Rota não encontrada' } });
  });

  // Limite em stream (rejeita antes de bufferizar o arquivo inteiro). O envio
  // de mídia é single-recipient, então `files: 1` é suficiente (doc 03 §3.3).
  await app.register(multipart, {
    limits: { fileSize: MEDIA_LIMITS.MAX_BYTES, files: 1 },
    attachFieldsToBody: true,
  });

  // ── /v1 autenticado (mensagens) ─────────────────────────────────────────
  // Dois preHandlers em ordem: (1) auth resolve req.auth, (2) rate limit lê o
  // limite do projeto de req.auth. Implementação manual porque o @fastify/rate-limit
  // resolve `max` antes do nosso preHandler de auth.
  await app.register(
    (v1, _opts, done) => {
      v1.addHook('preHandler', makeAuthPreHandler(redis));
      v1.addHook('preHandler', makeRateLimitPreHandler(redis));
      registerMessageRoutes(v1);
      registerMediaRoutes(v1);
      registerWebhookRoutes(v1);
      done();
    },
    { prefix: '/v1' },
  );

  // ── /v1/health — sem auth, sem rate limit ──────────────────────────────
  await app.register(
    (pub, _opts, done) => {
      registerHealthRoute(pub);
      done();
    },
    { prefix: '/v1' },
  );

  return app;
}

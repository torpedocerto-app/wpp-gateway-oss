import Fastify, { type FastifyInstance } from 'fastify';
import { loadEnv } from '@wpp/config';
import { prisma, AccountStatus } from '@wpp/database';
import { logger } from '../logger.js';
import type { SessionManager } from '../sessions/index.js';
import { Session } from '../sessions/index.js';
import { sessionDir } from '../sessions/paths.js';
import { registerChatRoutes } from './chat.js';
import { registerQueueRoutes } from './queue.js';

const env = loadEnv();

/**
 * API HTTP INTERNA do worker (Fase 6). Porta 3002, NUNCA publicada — só o painel
 * (Next.js server-side, na mesma rede Docker) a consome.
 *
 * Protegida por um token compartilhado simples (INTERNAL_API_TOKEN). Não é a
 * mesma coisa que os tokens de projeto da API pública.
 *
 * Responsabilidades: operações que exigem o processo do worker vivo —
 * gerar QR (SSE), pausar/retomar/reconectar/remover conta.
 */
export function buildInternalApi(manager: SessionManager): FastifyInstance {
  const app = Fastify({
    // Fastify 5 quer um objeto de config, não uma instância pino já criada.
    // Reproduz o formato do logger do worker.
    logger: {
      level: process.env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
      ...(env.NODE_ENV !== 'production'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
    },
  });

  // auth por token compartilhado
  app.addHook('onRequest', (req, reply, done) => {
    const auth = req.headers['x-internal-token'];
    if (!env.INTERNAL_API_TOKEN || auth !== env.INTERNAL_API_TOKEN) {
      void reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    done();
  });

  // ── POST /accounts — cria a conta no banco (sem parear ainda) ────────────
  app.post<{ Body: { label: string } }>('/accounts', async (req, reply) => {
    const label = (req.body?.label ?? '').trim();
    if (!label) {
      void reply.code(422).send({ error: 'label obrigatório' });
      return;
    }
    const account = await prisma.account.create({
      data: {
        label,
        status: AccountStatus.DISCONNECTED,
        sessionPath: '',
        dailyLimit: env.DEFAULT_DAILY_LIMIT,
        hourlyLimit: env.DEFAULT_HOURLY_LIMIT,
        warmupUntil: new Date(Date.now() + env.WARMUP_DAYS * 86_400_000),
      },
      select: { id: true, label: true },
    });
    await prisma.account.update({
      where: { id: account.id },
      data: { sessionPath: sessionDir(env.SESSIONS_PATH, account.id) },
    });
    return { accountId: account.id, label: account.label };
  });

  // ── GET /accounts/:id/qr — SSE do pareamento ──────────────────────────
  app.get<{ Params: { id: string } }>('/accounts/:id/qr', async (req, reply) => {
    const accountId = req.params.id;
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      void reply.code(404).send({ error: 'conta não encontrada' });
      return;
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // se já existe uma sessão viva pra essa conta, encerra antes (evita conflito 440)
    await manager.stop(accountId).catch(() => undefined);

    const session = new Session(accountId, env.SESSIONS_PATH, {
      onQr: (_id, qr, attempt) => send('qr', { qr, attempt }),
      onConnected: (_id, phone) => {
        send('connected', { phoneNumber: phone });
        reply.raw.end();
      },
      onTerminal: (_id, reason) => {
        send('failed', { reason });
        reply.raw.end();
      },
    });

    req.raw.on('close', () => {
      void session.stop();
    });

    session.start().catch((err: unknown) => {
      send('error', { message: err instanceof Error ? err.message : String(err) });
      reply.raw.end();
    });
  });

  // ── POST /accounts/:id/pause | resume | reconnect | remove ─────────────
  app.post<{ Params: { id: string } }>('/accounts/:id/pause', async (req) => {
    await prisma.account.update({
      where: { id: req.params.id },
      data: { isEnabled: false },
    });
    await manager.stop(req.params.id).catch(() => undefined);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/accounts/:id/resume', async (req) => {
    await prisma.account.update({
      where: { id: req.params.id },
      data: { isEnabled: true },
    });
    await manager.spawn(req.params.id).catch(() => undefined);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/accounts/:id/reconnect', async (req) => {
    await manager.stop(req.params.id).catch(() => undefined);
    await manager.spawn(req.params.id).catch(() => undefined);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/accounts/:id/remove', async (req) => {
    const { id } = req.params;
    // 1. derruba a sessão (logout no WhatsApp) + apaga credenciais do volume
    await manager.remove(id).catch(() => undefined);
    // 2. apaga a linha. FKs: messages.account_id → SET NULL (histórico preservado),
    //    message_attempts / account_events → CASCADE. Se a conta nem existe mais, ok.
    await prisma.account.delete({ where: { id } }).catch((err: unknown) => {
      logger.warn({ err, accountId: id }, 'account.delete falhou (talvez já removida)');
    });
    return { ok: true, deleted: true };
  });

  // ── GET /health ─────────────────────────────────────────────────────
  app.get('/health', () => ({ ok: true, sessions: manager.active.size }));

  // ── chat (Fase 6c) ─────────────────────────────────────────────────
  registerChatRoutes(app, manager);

  // ── fila (Fase 6b) ────────────────────────────────────────────────
  registerQueueRoutes(app);

  return app;
}

/** Sobe a API interna se INTERNAL_API_TOKEN estiver configurado. */
export async function startInternalApi(manager: SessionManager): Promise<FastifyInstance | null> {
  if (!env.INTERNAL_API_TOKEN) {
    logger.warn('INTERNAL_API_TOKEN ausente — API interna do worker desabilitada (painel não funcionará)');
    return null;
  }
  const app = buildInternalApi(manager);
  await app.listen({ port: env.INTERNAL_API_PORT, host: '0.0.0.0' });
  logger.info({ port: env.INTERNAL_API_PORT }, 'API interna do worker no ar');
  return app;
}

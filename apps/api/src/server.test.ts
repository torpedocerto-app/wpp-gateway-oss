/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/consistent-type-imports */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { seedProject, type SeededProject } from './test-helpers.js';

/**
 * Testes de contrato da API via app.inject() (doc 03). Precisam do Postgres do
 * docker no ar (`pnpm infra:up`).
 *
 * ⚠️ SEGURANÇA (lição da Fase 3): estes testes NUNCA devem disparar envio real.
 * Três camadas de proteção:
 *   1. `createAndEnqueue` é MOCKADO — grava a mensagem em `messages` (para testar
 *      idempotência, 404, cancel de verdade) mas NÃO enfileira job no BullMQ.
 *   2. Rodam com NODE_ENV=test → mesmo o mock que grava usa a fila `outbound-test`.
 *   3. O worker recusa subir com NODE_ENV=test.
 * Além disso, todos os números de destino são do range +55 11 90000-00XX, que
 * tem formato válido de celular mas não corresponde a linha ativa no WhatsApp.
 */

// ── mock parcial de @wpp/queue ─────────────────────────────────────────────
// Mantém makeStateConnection real (Redis para auth/rate-limit). Substitui:
//  - createAndEnqueue → grava a mensagem em `messages` mas NÃO enfileira job
//  - outboundQueue → stub que só responde getJobCounts (usado por /v1/health)
const enqueueSpy = vi.fn();

vi.mock('@wpp/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wpp/queue')>();
  const { prisma, MessageDirection, MessageStatus, Prisma } = await import('@wpp/database');

  async function createAndEnqueue(input: {
    projectId?: string | null;
    apiTokenId?: string | null;
    to: string;
    text: string;
    externalId?: string | null;
    media?: { data: string; mimetype: string; fileName?: string; caption?: string };
  }): Promise<{ messageId: string; status: 'queued' | 'duplicate' }> {
    enqueueSpy(input);
    const { projectId = null, externalId = null } = input;

    if (projectId && externalId) {
      const existing = await prisma.message.findFirst({
        where: { projectId, externalId },
        select: { id: true },
      });
      if (existing) return { messageId: existing.id, status: 'duplicate' };
    }

    try {
      const m = await prisma.message.create({
        data: {
          projectId,
          apiTokenId: input.apiTokenId ?? null,
          direction: MessageDirection.OUTBOUND,
          status: MessageStatus.QUEUED,
          toNumber: input.to,
          content: input.text,
          externalId,
          queuedAt: new Date(),
          mediaMimeType: input.media?.mimetype ?? null,
          mediaFileName: input.media?.fileName ?? null,
        },
        select: { id: true },
      });
      return { messageId: m.id, status: 'queued' };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        projectId &&
        externalId
      ) {
        const existing = await prisma.message.findFirst({
          where: { projectId, externalId },
          select: { id: true },
        });
        if (existing) return { messageId: existing.id, status: 'duplicate' };
      }
      throw err;
    }
  }

  return {
    ...actual,
    createAndEnqueue,
    outboundQueue: () => ({
      getJobCounts: () => Promise.resolve({ waiting: 0, delayed: 0, active: 0 }),
    }),
  };
});

const { buildServer } = await import('./server.js');
const { redis } = await import('./redis.js');

/** Números de teste: formato válido, linha inexistente (range 9000X). */
const TEST_TO = '11990000001';
const TEST_TO_2 = '11990000002';

let app: FastifyInstance;
const cleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(`testes de contrato exigem NODE_ENV=test (atual: ${process.env.NODE_ENV})`);
  }
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await redis.quit();
});

beforeEach(() => {
  enqueueSpy.mockClear();
});

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function project(over?: Parameters<typeof seedProject>[0]): Promise<SeededProject> {
  const p = await seedProject(over);
  cleanups.push(p.cleanup);
  return p;
}

/**
 * Monta um corpo multipart/form-data manualmente — `app.inject()` não tem
 * helper próprio pra multipart. Boundary fixo, um único arquivo + campos.
 */
const BOUNDARY = '----wpp-test-boundary';
function multipartBody(fields: {
  to?: string;
  caption?: string;
  externalId?: string;
  file?: { content: Buffer; filename: string; mimetype: string };
}): { payload: Buffer; contentType: string } {
  const parts: Buffer[] = [];
  const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));

  for (const [name, value] of Object.entries({
    to: fields.to,
    caption: fields.caption,
    externalId: fields.externalId,
  })) {
    if (value === undefined) continue;
    push(`--${BOUNDARY}\r\n`);
    push(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    push(`${value}\r\n`);
  }

  if (fields.file) {
    push(`--${BOUNDARY}\r\n`);
    push(
      `Content-Disposition: form-data; name="file"; filename="${fields.file.filename}"\r\n` +
        `Content-Type: ${fields.file.mimetype}\r\n\r\n`,
    );
    parts.push(fields.file.content);
    push('\r\n');
  }

  push(`--${BOUNDARY}--\r\n`);
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${BOUNDARY}` };
}

describe('auth (doc 03 §2)', () => {
  it('sem header → 401 MISSING_TOKEN', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/messages', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('MISSING_TOKEN');
  });

  it('token inexistente → 401 INVALID_TOKEN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: 'Bearer mk_live_naoexiste' },
      payload: { to: TEST_TO, text: 'x' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_TOKEN');
  });

  it('projeto inativo → 403 PROJECT_INACTIVE', async () => {
    const p = await project({ isActive: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${p.tokenPlain}` },
      payload: { to: TEST_TO, text: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PROJECT_INACTIVE');
  });
});

describe('POST /v1/messages (doc 03 §3.1)', () => {
  it('telefone inválido → 422 INVALID_PHONE_NUMBER', async () => {
    const p = await project();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${p.tokenPlain}` },
      payload: { to: '119', text: 'oi' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_PHONE_NUMBER');
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('texto acima de 4096 → 422 (validação Zod)', async () => {
    const p = await project();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${p.tokenPlain}` },
      payload: { to: TEST_TO, text: 'a'.repeat(4097) },
    });
    expect(res.statusCode).toBe(422);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('mensagem válida → 202, telefone normalizado, enqueue chamado 1x', async () => {
    const p = await project();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${p.tokenPlain}` },
      payload: { to: '(11) 99000-0001', text: 'ok' },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.messageId).toBeTruthy();
    expect(body.to).toBe('+5511990000001');
    expect(body.status).toBe('queued');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({ to: '+5511990000001' }));
  });

  it('idempotência: mesmo externalId → 200 com a mensagem original', async () => {
    const p = await project();
    const payload = { to: TEST_TO, text: 'idem', externalId: 'pedido-xyz-1' };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${p.tokenPlain}` },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${p.tokenPlain}` },
      payload,
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json().messageId).toBe(first.json().messageId);
  });

  it('agendamento no passado → 422 INVALID_SCHEDULE', async () => {
    const p = await project();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${p.tokenPlain}` },
      payload: { to: TEST_TO, text: 'x', scheduledFor: '2020-01-01T00:00:00Z' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_SCHEDULE');
  });
});

describe('cota diária (doc 03 §6)', () => {
  it('excede daily_quota → 429 DAILY_QUOTA_EXCEEDED com Retry-After', async () => {
    const p = await project({ dailyQuota: 1 });
    const h = { authorization: `Bearer ${p.tokenPlain}` };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: h,
      payload: { to: TEST_TO, text: 'a' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: h,
      payload: { to: TEST_TO_2, text: 'b' },
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('DAILY_QUOTA_EXCEEDED');
    expect(second.headers['retry-after']).toBeDefined();
  });
});

describe('GET /v1/messages/:id (doc 03 §3.4)', () => {
  it('mensagem de outro projeto → 404 (não 403)', async () => {
    const p1 = await project();
    const p2 = await project();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${p1.tokenPlain}` },
      payload: { to: TEST_TO, text: 'privada' },
    });
    const id = created.json().messageId;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/messages/${id}`,
      headers: { authorization: `Bearer ${p2.tokenPlain}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('MESSAGE_NOT_FOUND');
  });

  it('própria mensagem → 200 com timeline', async () => {
    const p = await project();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${p.tokenPlain}` },
      payload: { to: TEST_TO, text: 'minha' },
    });
    const id = created.json().messageId;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/messages/${id}`,
      headers: { authorization: `Bearer ${p.tokenPlain}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().timeline.createdAt).toBeTruthy();
    expect(res.json().status).toBe('queued');
  });
});

describe('POST /v1/messages/:id/cancel (doc 03 §3.6)', () => {
  it('cancela mensagem QUEUED', async () => {
    const p = await project();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${p.tokenPlain}` },
      payload: { to: TEST_TO, text: 'cancelar' },
    });
    const id = created.json().messageId;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/messages/${id}/cancel`,
      headers: { authorization: `Bearer ${p.tokenPlain}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('canceled');
  });
});

describe('rate limit por token (doc 03 §6)', () => {
  it('excede rate_limit_per_minute → 429 RATE_LIMIT_EXCEEDED', async () => {
    const p = await project({ rateLimitPerMinute: 3 });
    const h = { authorization: `Bearer ${p.tokenPlain}` };
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'GET', url: `/v1/messages`, headers: h });
      codes.push(r.statusCode);
      if (i === 0) {
        expect(r.headers['x-ratelimit-limit']).toBe('3');
        expect(r.headers['x-ratelimit-remaining']).toBe('2');
      }
    }
    expect(codes.filter((c) => c === 200).length).toBe(3);
    expect(codes.filter((c) => c === 429).length).toBe(2);
    const last = await app.inject({ method: 'GET', url: `/v1/messages`, headers: h });
    expect(last.statusCode).toBe(429);
    expect(last.json().error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(last.headers['retry-after']).toBeDefined();
  });
});

describe('GET /v1/health (doc 03 §3.7)', () => {
  it('responde sem auth, com contadores', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(['healthy', 'degraded', 'unavailable']).toContain(body.status);
    expect(typeof body.accountsTotal).toBe('number');
    expect(typeof body.queueDepth).toBe('number');
  });
});

describe('opt-out (doc 06 §5)', () => {
  const SUPPRESSED = '+5511990000099';

  afterEach(async () => {
    const { prisma } = await import('@wpp/database');
    await prisma.suppressedContact.deleteMany({ where: { phoneNumber: SUPPRESSED } });
  });

  it('POST /v1/messages para destinatário suprimido → 422 RECIPIENT_OPTED_OUT', async () => {
    const { prisma } = await import('@wpp/database');
    await prisma.suppressedContact.create({ data: { phoneNumber: SUPPRESSED } });

    const p = await project();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${p.tokenPlain}` },
      payload: { to: SUPPRESSED, text: 'oi' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('RECIPIENT_OPTED_OUT');
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('POST /v1/messages/bulk com um destinatário suprimido → item vai pra errors, resto segue', async () => {
    const { prisma } = await import('@wpp/database');
    await prisma.suppressedContact.create({ data: { phoneNumber: SUPPRESSED } });

    const p = await project();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/bulk',
      headers: { authorization: `Bearer ${p.tokenPlain}` },
      payload: {
        messages: [
          { to: SUPPRESSED, text: 'suprimido' },
          { to: TEST_TO, text: 'ok' },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(1);
    expect(body.errors).toEqual([
      expect.objectContaining({ index: 0, code: 'RECIPIENT_OPTED_OUT' }),
    ]);
  });
});

describe('POST /v1/messages/media (doc 03 §3.3)', () => {
  const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  it('imagem válida → 202, enqueue chamado com media', async () => {
    const p = await project();
    const { payload, contentType } = multipartBody({
      to: TEST_TO,
      caption: 'legenda',
      file: { content: PNG_1PX, filename: 'chart.png', mimetype: 'image/png' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/media',
      headers: { authorization: `Bearer ${p.tokenPlain}`, 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.messageId).toBeTruthy();
    expect(body.to).toBe('+5511990000001');
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        media: expect.objectContaining({ mimetype: 'image/png', fileName: 'chart.png' }),
      }),
    );
  });

  it('sem arquivo → 422 MISSING_MEDIA_FILE', async () => {
    const p = await project();
    const { payload, contentType } = multipartBody({ to: TEST_TO });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/media',
      headers: { authorization: `Bearer ${p.tokenPlain}`, 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MISSING_MEDIA_FILE');
  });

  it('mimetype não permitido → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const p = await project();
    const { payload, contentType } = multipartBody({
      to: TEST_TO,
      file: { content: Buffer.from('fake'), filename: 'arq.zip', mimetype: 'application/zip' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/media',
      headers: { authorization: `Bearer ${p.tokenPlain}`, 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('arquivo acima do limite → 413 MEDIA_TOO_LARGE', async () => {
    const p = await project();
    const big = Buffer.alloc(17 * 1024 * 1024, 1); // 17MB > teto de 16MB
    const { payload, contentType } = multipartBody({
      to: TEST_TO,
      file: { content: big, filename: 'grande.png', mimetype: 'image/png' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/media',
      headers: { authorization: `Bearer ${p.tokenPlain}`, 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('MEDIA_TOO_LARGE');
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('destinatário suprimido → 422 RECIPIENT_OPTED_OUT antes de ler o arquivo', async () => {
    const { prisma } = await import('@wpp/database');
    const phone = '+5511990000098';
    await prisma.suppressedContact.create({ data: { phoneNumber: phone } });

    const p = await project();
    const { payload, contentType } = multipartBody({
      to: phone,
      file: { content: PNG_1PX, filename: 'chart.png', mimetype: 'image/png' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/media',
      headers: { authorization: `Bearer ${p.tokenPlain}`, 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('RECIPIENT_OPTED_OUT');
    expect(enqueueSpy).not.toHaveBeenCalled();

    await prisma.suppressedContact.deleteMany({ where: { phoneNumber: phone } });
  });
});

/* eslint-disable @typescript-eslint/consistent-type-imports */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { prisma, WebhookDeliveryStatus } from '@wpp/database';
import { verifyWebhook, WEBHOOK_HEADERS } from '@wpp/shared';
import type { Job } from 'bullmq';
import type { WebhookJobData } from '@wpp/queue';

// não enfileira retry de verdade no BullMQ durante os testes
const enqueueWebhookSpy = vi.fn(() => Promise.resolve('fake-job-id'));
vi.mock('@wpp/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wpp/queue')>();
  return { ...actual, enqueueWebhook: enqueueWebhookSpy };
});

const { processWebhook } = await import('./process-webhook.js');

/**
 * Testa o processador de webhook contra um Fastify local que recebe o POST.
 * Precisa de Postgres (`pnpm infra:up`). Não usa BullMQ real — o `job` é um stub.
 */

const SECRET = 'whsec_test_abcdefghijklmnop';
let receiver: FastifyInstance;
let receiverUrl: string;
const received: Array<{ headers: Record<string, string>; bodyRaw: string; valid: boolean }> = [];
let nextStatus = 200;

const cleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  receiver = Fastify({ logger: false });
  // recebe o corpo COMO STRING (o HMAC assina o corpo bruto, não o parseado)
  receiver.removeAllContentTypeParsers();
  receiver.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  receiver.post('/hook', (req, reply) => {
    const bodyRaw = req.body as string;
    const sig = req.headers[WEBHOOK_HEADERS.SIGNATURE] as string | undefined;
    const ts = req.headers[WEBHOOK_HEADERS.TIMESTAMP] as string | undefined;
    const v = verifyWebhook(SECRET, { signature: sig, timestamp: ts }, bodyRaw);
    received.push({
      headers: req.headers as Record<string, string>,
      bodyRaw,
      valid: v.valid,
    });
    void reply.code(nextStatus).send({ ok: nextStatus < 300 });
  });
  await receiver.listen({ port: 0, host: '127.0.0.1' });
  const addr = receiver.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  receiverUrl = `http://127.0.0.1:${port}/hook`;
});

afterAll(async () => {
  await receiver.close();
});

afterEach(async () => {
  received.length = 0;
  nextStatus = 200;
  while (cleanups.length) await cleanups.pop()!();
});

async function seedProjectWithWebhook(url = receiverUrl): Promise<string> {
  const p = await prisma.project.create({
    data: {
      name: `wh-${Date.now()}`,
      slug: `wh-${Math.random().toString(36).slice(2, 10)}`,
      webhookUrl: url,
      webhookSecret: SECRET,
      webhookEvents: ['message.status', 'message.received'],
    },
    select: { id: true },
  });
  cleanups.push(async () => {
    await prisma.webhookDelivery.deleteMany({ where: { projectId: p.id } });
    await prisma.project.deleteMany({ where: { id: p.id } });
  });
  return p.id;
}

async function seedDelivery(projectId: string, event = 'message.status') {
  const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: { x: 1 } });
  const d = await prisma.webhookDelivery.create({
    data: {
      projectId,
      eventType: event,
      payload: JSON.parse(body) as object,
      status: WebhookDeliveryStatus.PENDING,
      attemptCount: 0,
    },
    select: { id: true },
  });
  return { deliveryId: d.id, body };
}

/** Stub mínimo de um Job do BullMQ. */
function fakeJob(data: WebhookJobData): Job<WebhookJobData> {
  return { data } as Job<WebhookJobData>;
}

describe('processWebhook (doc 03 §4)', () => {
  it('POST 2xx → delivery marcada DELIVERED, assinatura válida no receptor', async () => {
    const projectId = await seedProjectWithWebhook();
    const { deliveryId, body } = await seedDelivery(projectId);

    const result = await processWebhook(
      fakeJob({ deliveryId, projectId, event: 'message.status', bodyRaw: body, attemptsMade: 0 }),
    );

    expect(result.status).toBe('delivered');
    expect(received).toHaveLength(1);
    expect(received[0]!.valid).toBe(true); // HMAC verificou no receptor
    expect(received[0]!.bodyRaw).toBe(body); // corpo idêntico ao assinado

    const row = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    expect(row!.status).toBe(WebhookDeliveryStatus.DELIVERED);
    expect(row!.httpStatus).toBe(200);
    expect(row!.deliveredAt).not.toBeNull();
  });

  it('POST 500 → retry agendado, attemptCount incrementa', async () => {
    const projectId = await seedProjectWithWebhook();
    const { deliveryId, body } = await seedDelivery(projectId);
    nextStatus = 500;

    const result = await processWebhook(
      fakeJob({ deliveryId, projectId, event: 'message.status', bodyRaw: body, attemptsMade: 0 }),
    );

    expect(result.status).toBe('retrying');
    const row = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    expect(row!.status).toBe(WebhookDeliveryStatus.PENDING);
    expect(row!.attemptCount).toBe(1);
    expect(row!.nextRetryAt).not.toBeNull();
  });

  it('POST 400 → FAILED sem retry (erro de config do consumidor)', async () => {
    const projectId = await seedProjectWithWebhook();
    const { deliveryId, body } = await seedDelivery(projectId);
    nextStatus = 400;

    const result = await processWebhook(
      fakeJob({ deliveryId, projectId, event: 'message.status', bodyRaw: body, attemptsMade: 0 }),
    );

    expect(result.status).toBe('failed');
    const row = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    expect(row!.status).toBe(WebhookDeliveryStatus.FAILED);
  });

  it('esgotou as 6 tentativas → FAILED', async () => {
    const projectId = await seedProjectWithWebhook();
    const { deliveryId, body } = await seedDelivery(projectId);
    nextStatus = 503;

    const result = await processWebhook(
      fakeJob({ deliveryId, projectId, event: 'message.status', bodyRaw: body, attemptsMade: 6 }),
    );

    expect(result.status).toBe('failed');
    expect(result.detail).toMatch(/esgotado/);
    const row = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    expect(row!.status).toBe(WebhookDeliveryStatus.FAILED);
  });

  it('webhook_url malformada → FAILED sem POST', async () => {
    const projectId = await seedProjectWithWebhook('nao-e-url');
    const { deliveryId, body } = await seedDelivery(projectId);

    const result = await processWebhook(
      fakeJob({ deliveryId, projectId, event: 'message.status', bodyRaw: body, attemptsMade: 0 }),
    );

    expect(result.status).toBe('failed');
    expect(received).toHaveLength(0);
    const row = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    expect(row!.status).toBe(WebhookDeliveryStatus.FAILED);
  });

  // O anti-SSRF real (IP privado, http://, metadata) é testado de forma pura em
  // packages/shared/src/ssrf.test.ts. Aqui o processador roda com NODE_ENV=test,
  // que relaxa a checagem para permitir o receptor local em 127.0.0.1.
});

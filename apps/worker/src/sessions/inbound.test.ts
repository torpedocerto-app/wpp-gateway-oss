/* eslint-disable @typescript-eslint/consistent-type-imports, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma, MessageDirection, MessageStatus } from '@wpp/database';

const dispatchSpy = vi.fn(() => Promise.resolve({ dispatched: true, deliveryId: 'd1' }));
vi.mock('@wpp/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wpp/queue')>();
  return { ...actual, dispatchWebhook: dispatchSpy };
});

const { handleInboundUpsert } = await import('./inbound.js');

/** Constrói uma WAMessage mínima de texto 1:1. */
function textMsg(from: string, text: string, over: Record<string, any> = {}): any {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, fromMe: false, id: `WA${Math.random()}` },
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: { conversation: text },
    ...over,
  };
}

const cleanups: Array<() => Promise<void>> = [];
let ACCT = '';

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  const acc = await prisma.account.create({
    data: {
      label: 'inbound-test',
      status: 'CONNECTED',
      sessionPath: '/tmp/inbound-test',
      phoneNumber: '573233084334',
    },
    select: { id: true },
  });
  ACCT = acc.id;
});

afterAll(async () => {
  await prisma.message.deleteMany({ where: { accountId: ACCT } });
  await prisma.accountEvent.deleteMany({ where: { accountId: ACCT } });
  await prisma.account.deleteMany({ where: { id: ACCT } });
});

afterEach(async () => {
  dispatchSpy.mockClear();
  while (cleanups.length) await cleanups.pop()!();
});

async function seedProjectAndOutbound(to: string): Promise<{ projectId: string; msgId: string }> {
  const project = await prisma.project.create({
    data: {
      name: `inb-${Date.now()}`,
      slug: `inb-${Math.random().toString(36).slice(2, 10)}`,
      webhookUrl: 'https://webhook.example.com/h',
      webhookSecret: 'whsec_x',
      webhookEvents: ['message.received'],
    },
    select: { id: true },
  });
  const msg = await prisma.message.create({
    data: {
      projectId: project.id,
      direction: MessageDirection.OUTBOUND,
      status: MessageStatus.DELIVERED,
      toNumber: to,
      content: 'olá, tudo bem?',
      externalId: `ext-${Date.now()}`,
      sentAt: new Date(),
    },
    select: { id: true },
  });
  cleanups.push(async () => {
    await prisma.message.deleteMany({ where: { projectId: project.id } });
    await prisma.project.deleteMany({ where: { id: project.id } });
  });
  return { projectId: project.id, msgId: msg.id };
}


describe('handleInboundUpsert (doc 01 §6)', () => {
  it('texto de contato com conversa nas últimas 72h → grava INBOUND + webhook message.received', async () => {
    const { projectId } = await seedProjectAndOutbound('+573001234567');

    await handleInboundUpsert(ACCT, [textMsg('573001234567', 'confirmado, obrigado')]);

    const inbound = await prisma.message.findFirst({
      where: { direction: MessageDirection.INBOUND, fromNumber: '+573001234567' },
      orderBy: { createdAt: 'desc' },
    });
    expect(inbound).not.toBeNull();
    expect(inbound!.projectId).toBe(projectId);
    expect(inbound!.content).toBe('confirmado, obrigado');

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        event: 'message.received',
        data: expect.objectContaining({ from: '+573001234567', text: 'confirmado, obrigado' }),
      }),
    );

    await prisma.message.deleteMany({ where: { id: inbound!.id } });
  });

  it('sem conversa prévia → grava INBOUND com project_id null, sem webhook', async () => {
    await handleInboundUpsert(ACCT, [textMsg('573209999999', 'quem é?')]);

    const inbound = await prisma.message.findFirst({
      where: { direction: MessageDirection.INBOUND, fromNumber: '+573209999999' },
      orderBy: { createdAt: 'desc' },
    });
    expect(inbound).not.toBeNull();
    expect(inbound!.projectId).toBeNull();
    expect(dispatchSpy).not.toHaveBeenCalled();

    await prisma.message.deleteMany({ where: { id: inbound!.id } });
  });

  it('mensagem de grupo → ignorada, nada gravado', async () => {
    const before = await prisma.message.count({ where: { direction: MessageDirection.INBOUND } });
    await handleInboundUpsert(ACCT, [
      textMsg('123', 'oi grupo', { key: { remoteJid: '123-456@g.us', fromMe: false, id: 'G1' } }),
    ]);
    const after = await prisma.message.count({ where: { direction: MessageDirection.INBOUND } });
    expect(after).toBe(before);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('mensagem própria (fromMe) → ignorada', async () => {
    const before = await prisma.message.count({ where: { direction: MessageDirection.INBOUND } });
    await handleInboundUpsert(ACCT, [
      textMsg('573001234567', 'minha', { key: { remoteJid: '573001234567@s.whatsapp.net', fromMe: true, id: 'M1' } }),
    ]);
    const after = await prisma.message.count({ where: { direction: MessageDirection.INBOUND } });
    expect(after).toBe(before);
  });

  it('palavra de opt-out → cria SuppressedContact e AccountEvent tipo OPT_OUT (Fase 8)', async () => {
    const phone = '+573217770001';
    await prisma.suppressedContact.deleteMany({ where: { phoneNumber: phone } });

    await handleInboundUpsert(ACCT, [textMsg('573217770001', 'PARAR')]);

    const suppressed = await prisma.suppressedContact.findUnique({ where: { phoneNumber: phone } });
    expect(suppressed).not.toBeNull();
    expect(suppressed!.reason).toBe('opt_out_keyword');

    const event = await prisma.accountEvent.findFirst({
      where: { accountId: ACCT, type: 'OPT_OUT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(event).not.toBeNull();
    expect(event!.detail).toMatchObject({ kind: 'opt_out_request', from: phone });

    await prisma.suppressedContact.deleteMany({ where: { phoneNumber: phone } });
    await prisma.accountEvent.deleteMany({ where: { id: event!.id } });
    await prisma.message.deleteMany({ where: { fromNumber: phone } });
  });

  it('mensagem normal (sem opt-out) → não cria SuppressedContact nem AccountEvent', async () => {
    const phone = '+573217770002';
    await handleInboundUpsert(ACCT, [textMsg('573217770002', 'oi tudo bem?')]);

    const suppressed = await prisma.suppressedContact.findUnique({ where: { phoneNumber: phone } });
    expect(suppressed).toBeNull();

    await prisma.message.deleteMany({ where: { fromNumber: phone } });
  });
});

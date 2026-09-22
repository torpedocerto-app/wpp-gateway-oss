import { describe, expect, it, vi } from 'vitest';
import { sendMediaCore, sendTextCore, toJid } from './send.js';
import type { Session } from './session.js';

describe('toJid', () => {
  it('converte número E.164 com + para JID', () => {
    expect(toJid('+5511999998888')).toBe('5511999998888@s.whatsapp.net');
  });

  it('converte número sem + para JID', () => {
    expect(toJid('5511999998888')).toBe('5511999998888@s.whatsapp.net');
  });

  it('remove máscara e espaços', () => {
    expect(toJid('+55 (11) 99999-8888')).toBe('5511999998888@s.whatsapp.net');
  });
});

/** Fake mínimo de Session, só com o que `prepareSend`/os cores usam. */
function fakeSession(overrides: {
  ready?: boolean;
  socket?: Record<string, unknown> | null;
} = {}): Session {
  const sendMessage = vi.fn().mockResolvedValue({ key: { id: 'WA-ID-1' } });
  const onWhatsApp = vi.fn().mockResolvedValue([{ exists: true, jid: undefined }]);
  const sendPresenceUpdate = vi.fn().mockResolvedValue(undefined);
  const socket =
    overrides.socket === null
      ? null
      : { sendMessage, onWhatsApp, sendPresenceUpdate, ...overrides.socket };
  return {
    accountId: 'acc-1',
    socket,
    isReady: overrides.ready ?? true,
  } as unknown as Session;
}

describe('sendTextCore', () => {
  it('falha cedo sem socket', async () => {
    const session = fakeSession({ socket: null });
    const outcome = await sendTextCore(session, '+5511999998888', 'oi');
    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toMatch(/sem socket/);
  });

  it('falha cedo quando a sessão não está pronta', async () => {
    const session = fakeSession({ ready: false });
    const outcome = await sendTextCore(session, '+5511999998888', 'oi');
    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toMatch(/não está pronta/);
  });

  it('envia texto puro quando tudo está ok', async () => {
    const session = fakeSession();
    const outcome = await sendTextCore(session, '+5511999998888', 'oi');
    expect(outcome.ok).toBe(true);
    expect(outcome.whatsappMessageId).toBe('WA-ID-1');
    expect((session.socket as unknown as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).toHaveBeenCalledWith(
      '5511999998888@s.whatsapp.net',
      { text: 'oi' },
    );
  });
});

describe('sendMediaCore', () => {
  it('monta payload { image, caption, mimetype } para imagem', async () => {
    const session = fakeSession();
    const buffer = Buffer.from('fake-jpg');
    const outcome = await sendMediaCore(session, '+5511999998888', {
      buffer,
      mimetype: 'image/jpeg',
      caption: 'legenda',
    });
    expect(outcome.ok).toBe(true);
    expect((session.socket as unknown as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).toHaveBeenCalledWith(
      '5511999998888@s.whatsapp.net',
      { image: buffer, caption: 'legenda', mimetype: 'image/jpeg' },
    );
  });

  it('monta payload { document, mimetype, fileName, caption } para PDF', async () => {
    const session = fakeSession();
    const buffer = Buffer.from('fake-pdf');
    const outcome = await sendMediaCore(session, '+5511999998888', {
      buffer,
      mimetype: 'application/pdf',
      fileName: 'relatorio.pdf',
      caption: 'segue relatório',
    });
    expect(outcome.ok).toBe(true);
    expect((session.socket as unknown as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).toHaveBeenCalledWith(
      '5511999998888@s.whatsapp.net',
      { document: buffer, mimetype: 'application/pdf', fileName: 'relatorio.pdf', caption: 'segue relatório' },
    );
  });

  it('usa nome default quando fileName não é informado', async () => {
    const session = fakeSession();
    const outcome = await sendMediaCore(session, '+5511999998888', {
      buffer: Buffer.from('x'),
      mimetype: 'application/pdf',
    });
    expect(outcome.ok).toBe(true);
    expect((session.socket as unknown as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).toHaveBeenCalledWith(
      '5511999998888@s.whatsapp.net',
      expect.objectContaining({ fileName: 'documento.pdf' }),
    );
  });

  it('falha cedo sem socket, igual sendTextCore', async () => {
    const session = fakeSession({ socket: null });
    const outcome = await sendMediaCore(session, '+5511999998888', {
      buffer: Buffer.from('x'),
      mimetype: 'image/png',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toMatch(/sem socket/);
  });
});

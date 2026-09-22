import { describe, expect, it } from 'vitest';
import { classifyInbound, isOptOutRequest, type InboundCandidate } from './inbound-filter.js';

function candidate(over: Partial<InboundCandidate> = {}): InboundCandidate {
  return {
    remoteJid: '573001234567@s.whatsapp.net',
    fromMe: false,
    id: 'ABC123',
    text: 'olá',
    hasMedia: false,
    isEmptyOrProtocol: false,
    ...over,
  };
}

describe('classifyInbound (doc 01 §6)', () => {
  it('texto 1:1 de terceiro → process, extrai número e texto', () => {
    const d = classifyInbound(candidate({ text: '  confirmado  ' }));
    expect(d).toEqual({ action: 'process', text: 'confirmado', from: '573001234567' });
  });

  it('mensagem própria → ignore from_me', () => {
    expect(classifyInbound(candidate({ fromMe: true }))).toEqual({
      action: 'ignore',
      reason: 'from_me',
    });
  });

  it('grupo → ignore', () => {
    expect(classifyInbound(candidate({ remoteJid: '123456@g.us' })).action).toBe('ignore');
    expect(classifyInbound(candidate({ remoteJid: '123456@g.us' }))).toMatchObject({
      reason: 'group',
    });
  });

  it('status@broadcast → ignore', () => {
    expect(classifyInbound(candidate({ remoteJid: 'status@broadcast' }))).toMatchObject({
      reason: 'broadcast_or_status',
    });
  });

  it('newsletter → ignore', () => {
    expect(classifyInbound(candidate({ remoteJid: '111@newsletter' }))).toMatchObject({
      reason: 'newsletter',
    });
  });

  it('mídia sem texto → ignore media_unsupported', () => {
    expect(
      classifyInbound(candidate({ text: null, hasMedia: true })),
    ).toMatchObject({ reason: 'media_unsupported' });
  });

  it('mídia COM legenda → process (usa a legenda)', () => {
    const d = classifyInbound(candidate({ text: 'olha isso', hasMedia: true }));
    expect(d).toMatchObject({ action: 'process', text: 'olha isso' });
  });

  it('mensagem de protocolo (reação/revogação) → ignore', () => {
    expect(
      classifyInbound(candidate({ text: null, isEmptyOrProtocol: true })),
    ).toMatchObject({ reason: 'empty_or_protocol' });
  });

  it('sem JID → ignore', () => {
    expect(classifyInbound(candidate({ remoteJid: null }))).toMatchObject({ reason: 'no_jid' });
  });

  it('JID com device suffix → número limpo', () => {
    const d = classifyInbound(candidate({ remoteJid: '573001234567:12@s.whatsapp.net' }));
    expect(d).toMatchObject({ from: '573001234567' });
  });

  it('remoteJid é LID → usa o telefone de phoneJid (key.senderPn)', () => {
    const d = classifyInbound(
      candidate({
        remoteJid: '147983987437676@lid',
        phoneJid: '573001234567@s.whatsapp.net',
        text: 'oi',
      }),
    );
    expect(d).toEqual({ action: 'process', text: 'oi', from: '573001234567' });
  });

  it('remoteJid é LID SEM telefone associado → ignore lid_without_phone', () => {
    const d = classifyInbound(candidate({ remoteJid: '147983987437676@lid', phoneJid: null }));
    expect(d).toMatchObject({ reason: 'lid_without_phone' });
  });

  it('LID nunca vira "número" a partir do próprio LID', () => {
    const d = classifyInbound(candidate({ remoteJid: '147983987437676@lid' }));
    expect(d.action).toBe('ignore');
    if (d.action === 'process') throw new Error('LID não deveria ser processado');
  });
});

describe('isOptOutRequest (doc 06 §5)', () => {
  it('reconhece PARAR, sair, descadastrar, stop', () => {
    for (const w of ['PARAR', 'sair', 'Descadastrar', 'STOP', 'remover']) {
      expect(isOptOutRequest(w)).toBe(true);
    }
  });

  it('reconhece com acento e pontuação', () => {
    expect(isOptOutRequest('cancelar inscrição')).toBe(true);
    expect(isOptOutRequest('parar.')).toBe(true);
    expect(isOptOutRequest('STOP ')).toBe(true);
  });

  it('não confunde texto normal que contém a palavra', () => {
    expect(isOptOutRequest('não quero parar de receber')).toBe(false);
    expect(isOptOutRequest('vou sair de casa agora')).toBe(false);
  });
});

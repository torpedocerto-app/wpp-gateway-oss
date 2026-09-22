/**
 * Filtro de mensagens recebidas (doc 01 §6, Fase 4).
 *
 * O MVP só processa TEXTO de conversas 1:1. Mídia, grupos, status e mensagens
 * próprias são ignorados (mídia recebida é logada, não vira webhook).
 *
 * Função pura — recebe a forma mínima de uma mensagem do Baileys e decide.
 */

/** Forma mínima de uma WAMessage relevante para o filtro. */
export interface InboundCandidate {
  /** key.remoteJid — de quem/onde veio. Pode ser um LID (`...@lid`). */
  remoteJid: string | null | undefined;
  /**
   * key.remoteJidAlt / key.participantAlt — o JID de TELEFONE real, quando o
   * `remoteJid` veio como LID. É daqui que sai o número.
   */
  phoneJid?: string | null | undefined;
  /** key.fromMe — true se a própria conta enviou. */
  fromMe: boolean | null | undefined;
  /** key.id — id da mensagem no WhatsApp. */
  id: string | null | undefined;
  /** message.conversation ou message.extendedTextMessage.text. */
  text: string | null | undefined;
  /** true se message tem qualquer chave de mídia (image/audio/video/document/sticker). */
  hasMedia: boolean;
  /** true se message é vazio / apenas protocolo (reação, revogação, etc). */
  isEmptyOrProtocol: boolean;
}

export type InboundDecision =
  | { action: 'process'; text: string; from: string }
  | { action: 'ignore'; reason: InboundIgnoreReason };

export type InboundIgnoreReason =
  | 'from_me'
  | 'no_jid'
  | 'group'
  | 'broadcast_or_status'
  | 'newsletter'
  | 'lid_without_phone'
  | 'media_unsupported'
  | 'empty_or_protocol'
  | 'no_text';

/** Extrai só os dígitos do "user" de um JID de telefone. `null` se não for. */
function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@c.us')) return null;
  const user = jid.split('@')[0]?.split(':')[0] ?? '';
  return /^\d{6,15}$/.test(user) ? user : null;
}

export function classifyInbound(c: InboundCandidate): InboundDecision {
  if (c.fromMe) return { action: 'ignore', reason: 'from_me' };

  const jid = c.remoteJid ?? '';
  if (!jid) return { action: 'ignore', reason: 'no_jid' };
  if (jid.endsWith('@g.us')) return { action: 'ignore', reason: 'group' };
  if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) {
    return { action: 'ignore', reason: 'broadcast_or_status' };
  }
  if (jid.endsWith('@newsletter')) return { action: 'ignore', reason: 'newsletter' };

  if (c.isEmptyOrProtocol) return { action: 'ignore', reason: 'empty_or_protocol' };

  const text = (c.text ?? '').trim();
  if (!text) {
    return { action: 'ignore', reason: c.hasMedia ? 'media_unsupported' : 'no_text' };
  }

  // Resolve o NÚMERO real. Se remoteJid é um @lid, o telefone vem do phoneJid
  // (key.remoteJidAlt / participantAlt). Um LID sem telefone associado não dá
  // para correlacionar — ignora (raro; contato com privacidade máxima).
  const from = phoneFromJid(jid) ?? phoneFromJid(c.phoneJid);
  if (!from) {
    return { action: 'ignore', reason: jid.endsWith('@lid') ? 'lid_without_phone' : 'no_jid' };
  }

  return { action: 'process', text, from };
}

/** Palavras-chave de opt-out (doc 06 §5) — detecção; o bloqueio real fica em `@wpp/database` (`suppressContact`/`isSuppressed`). */
const OPT_OUT_KEYWORDS = [
  'parar',
  'sair',
  'descadastrar',
  'cancelar inscricao',
  'cancelar inscrição',
  'remover',
  'stop',
  'unsubscribe',
];

/** `true` se o texto recebido é um pedido de opt-out. */
export function isOptOutRequest(text: string): boolean {
  const norm = text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return OPT_OUT_KEYWORDS.some((k) => norm === k || norm.startsWith(k + ' ') || norm === k + '.');
}

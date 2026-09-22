import { isBoom } from '@hapi/boom';
import { classifySendError, composingDurationMs, type SendErrorCode } from '@wpp/shared';
import type { Session } from './session.js';
import { logger } from '../logger.js';

/** JID de usuário do WhatsApp a partir de um número E.164 (com ou sem +). */
export function toJid(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

export interface SendOutcome {
  /** true = o Baileys aceitou e enfileirou. Confirme entrega com waitForAck. */
  ok: boolean;
  whatsappMessageId?: string;
  durationMs: number;
  /** Preenchido quando ok=false — código da taxonomia (doc 05 §3). */
  errorCode?: SendErrorCode;
  errorMessage?: string;
}

/** Pausa mínima após a sessão ficar pronta, para o app-state sincronizar. */
const POST_READY_SETTLE_MS = 1_500;
/** Timeout do próprio sendMessage — além disso, classifica como SEND_TIMEOUT. */
const SEND_TIMEOUT_MS = 30_000;

interface SendCoreOpts {
  /** Se true, verifica onWhatsApp() antes de enviar (a fila já fez isso via cache). */
  checkExistence?: boolean;
  /** Se true, emite `composing` antes do envio (doc 05 §5). */
  simulateTyping?: boolean;
}

/** Dados de mídia já decodificados (bytes em memória), prontos pro Baileys. */
export interface MediaInput {
  buffer: Buffer;
  mimetype: string;
  fileName?: string;
  caption?: string;
}

type PrepareSendResult = { ok: true; jid: string } | { ok: false; outcome: SendOutcome };

/**
 * Checagens e preparação comuns a qualquer envio (texto ou mídia): socket
 * ativo, sessão pronta, (opcional) existência no WhatsApp + jid canônico,
 * (opcional) simulação de digitação, e o assertSession que garante a sessão
 * Signal com o destinatário antes do sendMessage de verdade.
 *
 * Devolve o jid pronto pra uso, ou já o SendOutcome de erro (socket ausente,
 * sessão não pronta, número não existe, falha no assertSession/onWhatsApp).
 */
async function prepareSend(
  session: Session,
  phone: string,
  text: string,
  opts: SendCoreOpts,
): Promise<PrepareSendResult> {
  const started = Date.now();
  const sock = session.socket;

  if (!sock) {
    return {
      ok: false,
      outcome: {
        ok: false,
        durationMs: 0,
        errorCode: classifySendError({ socketClosed: true }),
        errorMessage: 'sessão sem socket ativo',
      },
    };
  }
  if (!session.isReady) {
    return {
      ok: false,
      outcome: {
        ok: false,
        durationMs: 0,
        errorCode: classifySendError({ socketClosed: true }),
        errorMessage: 'sessão ainda não está pronta (handshake incompleto)',
      },
    };
  }

  let jid = toJid(phone);

  if (opts.checkExistence) {
    try {
      const results = await sock.onWhatsApp(jid);
      const check = results?.[0];
      if (!check?.exists) {
        return {
          ok: false,
          outcome: {
            ok: false,
            durationMs: Date.now() - started,
            errorCode: classifySendError({ numberNotOnWhatsApp: true }),
            errorMessage: 'número não possui WhatsApp',
          },
        };
      }
      // usa o jid canônico devolvido pelo WhatsApp
      if (check.jid) jid = check.jid;
    } catch (err) {
      return { ok: false, outcome: buildError(err, started) };
    }
  }

  try {
    // Garante a sessão Signal com o destinatário ANTES de enviar. Sem isto, a
    // primeira mensagem para um contato novo sai sem sessão criptográfica
    // estabelecida e o aparelho de destino não consegue descriptografar
    // (aviso "Aguardando mensagem"). O diagnóstico da Fase 3 confirmou que
    // assertSessions resolve.
    await assertSession(sock, jid);

    if (opts.simulateTyping) {
      await sock.sendPresenceUpdate('composing', jid);
      await sleep(composingDurationMs(text.length));
      await sock.sendPresenceUpdate('paused', jid);
    }

    return { ok: true, jid };
  } catch (err) {
    return { ok: false, outcome: buildError(err, started) };
  }
}

/**
 * Núcleo do envio de texto por uma sessão específica.
 *
 * NÃO faz sorteio, fila, fallback nem delays entre mensagens — isso é
 * responsabilidade de quem chama (o processador da fila na Fase 2, ou a CLI).
 * Aqui só: (opcional) checar existência, (opcional) simular digitação, enviar,
 * classificar o erro se houver.
 */
export async function sendTextCore(
  session: Session,
  phone: string,
  text: string,
  opts: SendCoreOpts = {},
): Promise<SendOutcome> {
  const started = Date.now();
  const prepared = await prepareSend(session, phone, text, opts);
  if (!prepared.ok) return prepared.outcome;

  try {
    const sent = await withTimeout(sock(session).sendMessage(prepared.jid, { text }), SEND_TIMEOUT_MS);
    const durationMs = Date.now() - started;
    logger.info(
      { accountId: session.accountId, to: phone, durationMs, id: sent?.key.id },
      'mensagem aceita pelo Baileys (aguardando ack)',
    );
    return { ok: true, whatsappMessageId: sent?.key.id ?? undefined, durationMs };
  } catch (err) {
    return buildError(err, started);
  }
}

/**
 * Núcleo do envio de mídia (imagem/PDF) por uma sessão específica — mesmas
 * checagens de `sendTextCore` via `prepareSend`, mas monta o payload do
 * Baileys por tipo: `{ image, caption, mimetype }` para imagens, `{ document,
 * mimetype, fileName, caption }` para o resto (hoje só PDF, doc 03 §3.3).
 *
 * `simulateTyping`, quando pedido, usa o tamanho da legenda (não do arquivo).
 */
export async function sendMediaCore(
  session: Session,
  phone: string,
  media: MediaInput,
  opts: SendCoreOpts = {},
): Promise<SendOutcome> {
  const started = Date.now();
  const prepared = await prepareSend(session, phone, media.caption ?? '', opts);
  if (!prepared.ok) return prepared.outcome;

  try {
    const content = media.mimetype.startsWith('image/')
      ? { image: media.buffer, caption: media.caption, mimetype: media.mimetype }
      : {
          document: media.buffer,
          mimetype: media.mimetype,
          fileName: media.fileName ?? 'documento.pdf',
          caption: media.caption,
        };
    const sent = await withTimeout(sock(session).sendMessage(prepared.jid, content), SEND_TIMEOUT_MS);
    const durationMs = Date.now() - started;
    logger.info(
      { accountId: session.accountId, to: phone, durationMs, id: sent?.key.id, mimetype: media.mimetype },
      'mídia aceita pelo Baileys (aguardando ack)',
    );
    return { ok: true, whatsappMessageId: sent?.key.id ?? undefined, durationMs };
  } catch (err) {
    return buildError(err, started);
  }
}

/** `prepareSend` já validou socket/isReady; isto só evita repetir o `!` em cada call site. */
function sock(session: Session): NonNullable<Session['socket']> {
  return session.socket as NonNullable<Session['socket']>;
}

/**
 * Envio simples usado pela CLI de teste (Fase 1) — checa existência e simula
 * digitação, wrapper fino sobre o núcleo.
 */
export function sendText(session: Session, phone: string, text: string): Promise<SendOutcome> {
  return sendTextCore(session, phone, text, { checkExistence: true, simulateTyping: true });
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Força o estabelecimento da sessão Signal com o destinatário (busca prekey
 * bundle se necessário). `assertSessions` é interno do Baileys mas estável na
 * prática; se ausente numa versão futura, o envio segue sem ele.
 */
async function assertSession(sock: unknown, jid: string): Promise<void> {
  const fn = (
    sock as { assertSessions?: (jids: string[], force: boolean) => Promise<unknown> }
  ).assertSessions;
  if (typeof fn !== 'function') return;
  try {
    await fn.call(sock, [jid], true);
  } catch (err) {
    // não bloqueia o envio; o sendMessage do Baileys também tenta resolver a sessão
    logger.warn({ err, jid }, 'assertSessions falhou (seguindo com o envio)');
  }
}

function buildError(err: unknown, started: number): SendOutcome {
  const message = err instanceof Error ? err.message : String(err);
  const boomStatus = isBoom(err) ? err.output.statusCode : undefined;
  const timedOut = message === 'timeout';
  const code = classifySendError({ message, boomStatus, timedOut });
  logger.error({ err, code }, 'falha no envio');
  return { ok: false, durationMs: Date.now() - started, errorCode: code, errorMessage: message };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

export { POST_READY_SETTLE_MS };

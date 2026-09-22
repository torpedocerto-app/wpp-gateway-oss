import type { WAMessage } from 'baileys';
import { prisma, MessageDirection, MessageStatus, suppressContact } from '@wpp/database';
import { classifyInbound, isOptOutRequest, type InboundCandidate } from '@wpp/shared';
import { dispatchWebhook } from '@wpp/queue';
import { logger } from '../logger.js';
import { publishInboundToChat } from '../internal-api/chat.js';

/** Janela de correlação inbound → projeto (doc 01 §6). */
const CORRELATION_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Processa um evento `messages.upsert` do Baileys (Fase 4).
 *
 *  1. filtra (só texto 1:1, ignora grupos/status/próprias)
 *  2. grava a mensagem (direction=INBOUND)
 *  3. correlaciona com o projeto da última OUTBOUND para aquele número em 72h
 *  4. resolve `inReplyTo` se a mensagem cita uma específica (quoted)
 *  5. dispara webhook `message.received` se o projeto assinou
 */
export async function handleInboundUpsert(accountId: string, messages: WAMessage[]): Promise<void> {
  for (const m of messages) {
    try {
      await handleOne(accountId, m);
    } catch (err) {
      logger.error({ err, accountId, key: m.key }, 'falha ao processar inbound');
    }
  }
}

async function handleOne(accountId: string, m: WAMessage): Promise<void> {
  const candidate = toCandidate(m);
  const decision = classifyInbound(candidate);

  if (decision.action === 'ignore') {
    logger.debug({ accountId, reason: decision.reason, jid: candidate.remoteJid }, 'inbound ignorado');
    return;
  }

  const { from, text } = decision;

  // ── correlação com projeto (doc 01 §6) ──────────────────────────────────
  const lastOutbound = await prisma.message.findFirst({
    where: {
      direction: MessageDirection.OUTBOUND,
      toNumber: { in: [`+${from}`, from] },
      createdAt: { gte: new Date(Date.now() - CORRELATION_WINDOW_MS) },
      status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ] },
    },
    select: { id: true, projectId: true, externalId: true },
    orderBy: { createdAt: 'desc' },
  });

  const projectId = lastOutbound?.projectId ?? null;

  // ── inReplyTo se houver quoted message ─────────────────────────────────
  const quotedId = extractQuotedId(m);
  let inReplyTo: { messageId: string; externalId: string | null } | null = null;
  if (quotedId) {
    const quoted = await prisma.message.findFirst({
      where: { whatsappMessageId: quotedId },
      select: { id: true, externalId: true },
    });
    if (quoted) inReplyTo = { messageId: quoted.id, externalId: quoted.externalId };
  }
  // sem quoted mas há conversa: aponta para a última outbound
  if (!inReplyTo && lastOutbound) {
    inReplyTo = { messageId: lastOutbound.id, externalId: lastOutbound.externalId };
  }

  // ── grava a mensagem inbound ──────────────────────────────────────────
  const received = await prisma.message.create({
    data: {
      projectId,
      accountId,
      direction: MessageDirection.INBOUND,
      status: MessageStatus.DELIVERED, // inbound "entregue" a nós por definição
      toNumber: `+${from}`, // normalizamos com o +
      fromNumber: `+${from}`,
      content: text,
      whatsappMessageId: m.key.id ?? null,
    },
    select: { id: true },
  });

  logger.info(
    { accountId, from, projectId: projectId ?? '(não atribuído)', optOut: isOptOutRequest(text) },
    'mensagem recebida',
  );

  // empurra para os streams SSE do chat abertos no painel (Fase 6c)
  publishInboundToChat(accountId, `+${from}`, text);

  // opt-out real (Fase 8 concluída, doc 06 §5): suprime o número pra TODO o
  // tenant — quem pede pra parar não sabe (nem deve precisar saber) qual
  // conta do pool está mandando.
  if (isOptOutRequest(text)) {
    await suppressContact(`+${from}`, 'opt_out_keyword').catch((err) =>
      logger.error({ err, accountId, from }, 'falha ao registrar suppressed_contact'),
    );
    await prisma.accountEvent
      .create({
        data: {
          accountId,
          type: 'OPT_OUT',
          detail: { kind: 'opt_out_request', from: `+${from}`, text },
        },
      })
      .catch(() => undefined);
  }

  // ── webhook message.received ─────────────────────────────────────────
  if (projectId) {
    await dispatchWebhook({
      projectId,
      event: 'message.received',
      messageId: received.id,
      data: {
        messageId: received.id,
        from: `+${from}`,
        text,
        receivedAt: new Date(
          typeof m.messageTimestamp === 'number'
            ? m.messageTimestamp * 1000
            : Number(m.messageTimestamp) * 1000,
        ).toISOString(),
        inReplyTo: inReplyTo
          ? { messageId: inReplyTo.messageId, externalId: inReplyTo.externalId }
          : null,
      },
    });
  }
}

// ── extração da forma mínima da WAMessage ──────────────────────────────────

function toCandidate(m: WAMessage): InboundCandidate {
  const msg = m.message ?? {};
  const text =
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    null;

  const hasMedia = Boolean(
    msg.imageMessage ||
      msg.videoMessage ||
      msg.audioMessage ||
      msg.documentMessage ||
      msg.stickerMessage,
  );

  // protocolo/vazio: sem conteúdo textual nem mídia, ou é protocolMessage/reaction
  const isEmptyOrProtocol =
    Boolean(msg.protocolMessage || msg.reactionMessage || msg.pollUpdateMessage) ||
    (!text && !hasMedia && Object.keys(msg).length === 0);

  // Quando remoteJid é um LID (@lid), o telefone real está em key.senderPn
  // ("phone number") — ou participantPn em contextos de grupo.
  const phoneJid = m.key.senderPn ?? m.key.participantPn ?? null;

  return {
    remoteJid: m.key.remoteJid,
    phoneJid,
    fromMe: m.key.fromMe,
    id: m.key.id,
    text,
    hasMedia,
    isEmptyOrProtocol,
  };
}

/** id da mensagem citada (quoted), se houver. */
function extractQuotedId(m: WAMessage): string | null {
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  return ctx?.stanzaId ?? null;
}

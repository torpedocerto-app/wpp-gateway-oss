import { prisma, MessageDirection, MessageStatus, Prisma } from '@wpp/database';
import { enqueueOutbound, OUTBOUND_PRIORITY } from './queues.js';

export interface CreateAndEnqueueInput {
  projectId?: string | null;
  apiTokenId?: string | null;
  to: string;
  text: string;
  externalId?: string | null;
  preferredAccountId?: string | null;
  urgent?: boolean;
  bulk?: boolean;
  /** Mídia (imagem/PDF) — ver `OutboundJobData.media` (doc 05 §9). */
  media?: {
    data: string;
    mimetype: string;
    fileName?: string;
    caption?: string;
  };
}

export interface EnqueueResult {
  messageId: string;
  status: 'queued' | 'duplicate';
  jobId?: string;
}

/**
 * Cria a mensagem em `messages` (status QUEUED) e enfileira o job outbound.
 *
 * Idempotência (doc 05 §6): se já existe (projectId, externalId), devolve a
 * mensagem original sem criar nem enfileirar de novo. A corrida entre duas
 * chamadas simultâneas é resolvida pelo índice único parcial — o segundo INSERT
 * viola a constraint e caímos no ramo `duplicate`.
 */
export async function createAndEnqueue(input: CreateAndEnqueueInput): Promise<EnqueueResult> {
  const { projectId = null, externalId = null } = input;

  if (projectId && externalId) {
    const existing = await prisma.message.findFirst({
      where: { projectId, externalId },
      select: { id: true, createdAt: true },
    });
    if (existing) {
      return { messageId: existing.id, status: 'duplicate' };
    }
  }

  let message: { id: string; createdAt: Date };
  try {
    message = await prisma.message.create({
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
      select: { id: true, createdAt: true },
    });
  } catch (err) {
    // Corrida de idempotência: outro request criou primeiro.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && projectId && externalId) {
      const existing = await prisma.message.findFirst({
        where: { projectId, externalId },
        select: { id: true },
      });
      if (existing) return { messageId: existing.id, status: 'duplicate' };
    }
    throw err;
  }

  const jobId = await enqueueOutbound(
    {
      messageId: message.id,
      messageCreatedAt: message.createdAt.toISOString(),
      to: input.to,
      text: input.text,
      preferredAccountId: input.preferredAccountId ?? null,
      triedAccountIds: [],
      urgent: input.urgent ?? false,
      media: input.media,
    },
    { priority: input.bulk ? OUTBOUND_PRIORITY.BULK : OUTBOUND_PRIORITY.NORMAL },
  );

  return { messageId: message.id, status: 'queued', jobId };
}

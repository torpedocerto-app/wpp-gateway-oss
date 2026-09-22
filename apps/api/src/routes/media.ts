import type { FastifyInstance } from 'fastify';
import type { MultipartFile, MultipartValue } from '@fastify/multipart';
import { prisma, MessageStatus, isSuppressed } from '@wpp/database';
import { ApiError, normalizePhone, isAllowedMimeType } from '@wpp/shared';
import { createAndEnqueue } from '@wpp/queue';

/** Corpo de `POST /messages/media` depois do `attachFieldsToBody` do @fastify/multipart. */
interface MediaBody {
  to?: MultipartValue<string>;
  caption?: MultipartValue<string>;
  externalId?: MultipartValue<string>;
  file?: MultipartFile;
}

/**
 * Rota de envio de mídia (doc 03 §3.3) — endpoint separado de `/messages`
 * porque o contrato é multipart, não JSON. Single-recipient só (sem bulk).
 */
export function registerMediaRoutes(app: FastifyInstance): void {
  // ── POST /v1/messages/media ─────────────────────────────────────────────
  app.post('/messages/media', async (req, reply) => {
    const body = req.body as MediaBody | undefined;

    const toRaw = body?.to?.value;
    if (!toRaw) throw new ApiError('INVALID_PHONE_NUMBER', { field: 'to' });

    let phone: string;
    try {
      phone = normalizePhone(toRaw).e164;
    } catch {
      throw new ApiError('INVALID_PHONE_NUMBER', { field: 'to', value: toRaw });
    }

    // Checagem rápida de supressão, antes de gastar tempo lendo o arquivo.
    if (await isSuppressed(phone)) {
      throw new ApiError('RECIPIENT_OPTED_OUT', { to: phone });
    }

    const file = body?.file;
    if (!file) throw new ApiError('MISSING_MEDIA_FILE');

    if (!isAllowedMimeType(file.mimetype)) {
      throw new ApiError('UNSUPPORTED_MEDIA_TYPE', { mimetype: file.mimetype });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new ApiError('MEDIA_TOO_LARGE');
      }
      throw err;
    }

    const caption = body?.caption?.value ?? '';
    const externalId = body?.externalId?.value ?? null;

    const result = await createAndEnqueue({
      projectId: req.auth.projectId,
      apiTokenId: req.auth.apiTokenId,
      to: phone,
      text: caption,
      externalId,
      media: {
        data: buffer.toString('base64'),
        mimetype: file.mimetype,
        fileName: file.filename,
        caption,
      },
    });

    const message = await prisma.message.findFirst({
      where: { id: result.messageId },
      select: { id: true, status: true, externalId: true, createdAt: true },
    });

    // idempotência: já existia → 200; nova → 202 (doc 03 §3.1)
    reply.code(result.status === 'duplicate' ? 200 : 202);
    return {
      messageId: result.messageId,
      status: (message?.status ?? MessageStatus.QUEUED).toLowerCase(),
      to: phone,
      externalId: message?.externalId ?? null,
      createdAt: message?.createdAt.toISOString(),
    };
  });
}

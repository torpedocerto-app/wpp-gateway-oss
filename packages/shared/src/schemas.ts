import { z } from 'zod';

/**
 * Schemas Zod do contrato da API pública (doc 03 §3).
 * Compartilhados entre a validação da API e os testes/clientes.
 */

/** Telefone: aceita formatos variados, normalização acontece no servidor (doc 03 §5). */
const phoneInput = z
  .string()
  .min(8)
  .max(20)
  .regex(/^[\d\s()+-]+$/, 'Caracteres inválidos no telefone');

/** POST /v1/messages (doc 03 §3.1). */
export const sendMessageSchema = z.object({
  to: phoneInput,
  text: z.string().min(1).max(4096),
  externalId: z.string().min(1).max(128).optional(),
  scheduledFor: z.string().datetime({ offset: true }).optional(),
  preferredAccountId: z.string().uuid().optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** POST /v1/messages/bulk (doc 03 §3.2) — até 500 destinatários. */
export const bulkMessageSchema = z.object({
  messages: z
    .array(
      z.object({
        to: phoneInput,
        text: z.string().min(1).max(4096),
        externalId: z.string().min(1).max(128).optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type BulkMessageInput = z.infer<typeof bulkMessageSchema>;

/** Query de GET /v1/messages (doc 03 §3.5). */
export const listMessagesQuerySchema = z.object({
  status: z.string().optional(),
  direction: z.enum(['OUTBOUND', 'INBOUND']).optional(),
  to: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

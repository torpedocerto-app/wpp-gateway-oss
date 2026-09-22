/**
 * Enums do domínio. Espelham exatamente os enums do banco (doc 02) e são a
 * fonte única de verdade compartilhada entre API, worker e painel.
 *
 * Ao alterar aqui, gerar migration correspondente em @wpp/database.
 */

/** Estado de uma conta WhatsApp do pool (doc 02 §2.1). */
export const AccountStatus = {
  DISCONNECTED: 'DISCONNECTED',
  QR_PENDING: 'QR_PENDING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  BANNED: 'BANNED',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

/** Contas elegíveis para o sorteio (doc 02 §2.1, doc 05 §2.1). */
export const ELIGIBLE_ACCOUNT_STATUS: readonly AccountStatus[] = [AccountStatus.CONNECTED];

/** Direção da mensagem (doc 02 §2.4). */
export const MessageDirection = {
  OUTBOUND: 'OUTBOUND',
  INBOUND: 'INBOUND',
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

/** Estado de uma mensagem (doc 02 §2.4). */
export const MessageStatus = {
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

/** Resultado de uma tentativa de envio (doc 02 §2.5). */
export const AttemptResult = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;
export type AttemptResult = (typeof AttemptResult)[keyof typeof AttemptResult];

/** Tipos de evento de conta para auditoria (doc 02 §2.6). */
export const AccountEventType = {
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  QR_GENERATED: 'QR_GENERATED',
  BAN_DETECTED: 'BAN_DETECTED',
  RECONNECT_ATTEMPT: 'RECONNECT_ATTEMPT',
  MANUALLY_DISABLED: 'MANUALLY_DISABLED',
  LIMIT_REACHED: 'LIMIT_REACHED',
  OPT_OUT: 'OPT_OUT',
} as const;
export type AccountEventType = (typeof AccountEventType)[keyof typeof AccountEventType];

/** Estado de entrega de um webhook (doc 02 §2.7). */
export const WebhookDeliveryStatus = {
  PENDING: 'PENDING',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
} as const;
export type WebhookDeliveryStatus =
  (typeof WebhookDeliveryStatus)[keyof typeof WebhookDeliveryStatus];

/** Eventos de webhook que um projeto pode assinar (doc 03 §4). */
export const WebhookEvent = {
  MESSAGE_STATUS: 'message.status',
  MESSAGE_RECEIVED: 'message.received',
} as const;
export type WebhookEvent = (typeof WebhookEvent)[keyof typeof WebhookEvent];

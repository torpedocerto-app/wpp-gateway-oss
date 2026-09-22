import { Queue } from 'bullmq';
import { makeQueueConnection } from './connection.js';

/**
 * Filas BullMQ (doc 05 §1).
 *
 * `outbound`  — envio de mensagens. Concorrência = tamanho do pool, com lock
 *               Redis por conta garantindo 1 envio por conta por vez.
 * `webhook`   — entrega de webhooks aos projetos (Fase 4).
 * `maintenance` — health check, agregação, limpeza (Fase 7).
 */

/**
 * Sufixo de ambiente nos nomes de fila.
 *
 * ⚠️ SEGURANÇA: em NODE_ENV=test a fila é `outbound-test`, ISOLADA da fila real.
 * Isso impede que testes de contrato da API — que criam mensagens e enfileiram
 * de verdade — sejam consumidos por um worker de dev/prod rodando em paralelo
 * (foi o que disparou envios reais indevidos na Fase 3).
 */
const ENV_SUFFIX = process.env.NODE_ENV === 'test' ? '-test' : '';

export const QUEUE_NAMES = {
  OUTBOUND: `outbound${ENV_SUFFIX}`,
  WEBHOOK: `webhook${ENV_SUFFIX}`,
  MAINTENANCE: `maintenance${ENV_SUFFIX}`,
} as const;

/** Prioridades da fila outbound (doc 05 §1.1). Menor número = mais prioritário. */
export const OUTBOUND_PRIORITY = {
  FALLBACK_RETRY: 1,
  NORMAL: 5,
  BULK: 10,
} as const;

export interface OutboundJobData {
  /** id da mensagem em `messages` (Postgres). */
  messageId: string;
  /** created_at ISO — necessário para localizar a linha na tabela particionada. */
  messageCreatedAt: string;
  to: string;
  text: string;
  preferredAccountId?: string | null;
  /** ids de contas já tentadas nesta mensagem (fallback, doc 05 §4). */
  triedAccountIds: string[];
  /** true = ignora a janela de silêncio (doc 05 §5). */
  urgent?: boolean;
  /**
   * Mídia (imagem/PDF), quando presente — os bytes trafegam só aqui (base64),
   * nunca são persistidos no Postgres (doc 05 §9). Job de vida curta, então o
   * teto prático do Redis (`proto-max-bulk-len`, 512MB default) sobra folga.
   */
  media?: {
    /** bytes do arquivo, codificados em base64. */
    data: string;
    mimetype: string;
    fileName?: string;
    caption?: string;
  };
}

let _outbound: Queue<OutboundJobData> | null = null;

/** Fila outbound (singleton). */
export function outboundQueue(): Queue<OutboundJobData> {
  _outbound ??= new Queue<OutboundJobData>(QUEUE_NAMES.OUTBOUND, {
    connection: makeQueueConnection(),
    defaultJobOptions: {
      attempts: 1, // o retry/fallback é lógica NOSSA, não do BullMQ (doc 05 §4)
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
  });
  return _outbound;
}

/** Enfileira um envio. `delayMs` posterga (janela de silêncio, retry de fallback). */
export async function enqueueOutbound(
  data: OutboundJobData,
  opts: { priority?: number; delayMs?: number } = {},
): Promise<string> {
  const job = await outboundQueue().add('send', data, {
    priority: opts.priority ?? OUTBOUND_PRIORITY.NORMAL,
    delay: opts.delayMs ?? 0,
  });
  return job.id ?? '';
}

// ── fila de webhook (Fase 4) ────────────────────────────────────────────────

export interface WebhookJobData {
  /** id da linha em `webhook_deliveries`. */
  deliveryId: string;
  projectId: string;
  /** 'message.status' | 'message.received' */
  event: string;
  /** corpo JÁ serializado (o HMAC assina exatamente esta string). */
  bodyRaw: string;
  /** tentativas já feitas (0-based). O worker incrementa a cada retry. */
  attemptsMade: number;
}

let _webhook: Queue<WebhookJobData> | null = null;

export function webhookQueue(): Queue<WebhookJobData> {
  _webhook ??= new Queue<WebhookJobData>(QUEUE_NAMES.WEBHOOK, {
    connection: makeQueueConnection(),
    defaultJobOptions: {
      attempts: 1, // retry é lógica nossa (doc 03 §4.4), não do BullMQ
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return _webhook;
}

/** Enfileira uma entrega de webhook. `delayMs` posterga (retry). */
export async function enqueueWebhook(
  data: WebhookJobData,
  opts: { delayMs?: number } = {},
): Promise<string> {
  const job = await webhookQueue().add('deliver', data, { delay: opts.delayMs ?? 0 });
  return job.id ?? '';
}

export async function closeQueues(): Promise<void> {
  await _outbound?.close();
  await _webhook?.close();
  _outbound = null;
  _webhook = null;
}

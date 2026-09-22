import { env } from './env';

/**
 * Cliente da API interna do worker (Fase 6). Só server-side.
 * O token compartilhado (INTERNAL_API_TOKEN) autentica a chamada.
 */

function headers(withBody = false): HeadersInit {
  if (!env.INTERNAL_API_TOKEN) throw new Error('INTERNAL_API_TOKEN não configurado');
  const h: Record<string, string> = { 'x-internal-token': env.INTERNAL_API_TOKEN };
  // Só declara JSON quando REALMENTE há corpo — o Fastify 5 rejeita com 400
  // (FST_ERR_CTP_EMPTY_JSON_BODY) um POST sem body mas com content-type: application/json.
  if (withBody) h['content-type'] = 'application/json';
  return h;
}

async function call<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.WORKER_INTERNAL_URL}${path}`, {
      method,
      headers: headers(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new Error(
      `Worker inacessível em ${env.WORKER_INTERNAL_URL}. Ele está rodando? (pnpm worker:dev)`,
    );
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    try {
      const j = JSON.parse(txt) as { error?: string };
      if (j.error) throw new Error(j.error);
    } catch {
      /* não era JSON */
    }
    throw new Error(`worker API ${res.status}: ${txt || 'sem corpo'}`);
  }
  return res.json() as Promise<T>;
}

const post = <T = unknown>(path: string, body?: unknown) => call<T>('POST', path, body);
const get = <T = unknown>(path: string) => call<T>('GET', path);

export interface QueueJob {
  id: string;
  name: string;
  priority?: number;
  delayUntil: string | null;
  attemptsMade: number;
  failedReason: string | null;
  data: { messageId?: string; to?: string; triedAccountIds: string[] };
  addedAt: string;
}

export const workerApi = {
  createAccount: (label: string) => post<{ accountId: string; label: string }>('/accounts', { label }),
  pauseAccount: (id: string) => post(`/accounts/${id}/pause`),
  resumeAccount: (id: string) => post(`/accounts/${id}/resume`),
  reconnectAccount: (id: string) => post(`/accounts/${id}/reconnect`),
  removeAccount: (id: string) => post(`/accounts/${id}/remove`),
  /** URL do SSE de QR — o browser abre um EventSource nela via rota proxy do painel. */
  qrStreamUrl: (id: string) => `${env.WORKER_INTERNAL_URL}/accounts/${id}/qr`,

  // ── chat (Fase 6c) ────────────────────────────────────────────────
  chatSend: (accountId: string, to: string, text: string) =>
    post<{ messageId: string; ack: string; createdAt: string }>('/chat/send', {
      accountId,
      to,
      text,
    }),
  chatTyping: (accountId: string, to: string, state: 'composing' | 'paused') =>
    post('/chat/typing', { accountId, to, state }).catch(() => undefined),

  // ── fila (Fase 6b) ────────────────────────────────────────────────
  queueStatus: () =>
    get<{
      outbound: Record<string, number>;
      webhook: Record<string, number>;
      outboundPaused: boolean;
    }>('/queue/status'),
  queueJobs: (state: string, limit = 50) =>
    get<{ jobs: QueueJob[] }>(`/queue/jobs?state=${state}&limit=${limit}`),
  queuePause: () => post<{ paused: boolean }>('/queue/pause'),
  queueResume: () => post<{ paused: boolean }>('/queue/resume'),
  queueRetryFailed: () => post<{ retried: number }>('/queue/retry-failed'),
  queueCleanCompleted: () => post<{ removed: number }>('/queue/clean-completed'),

  health: () =>
    fetch(`${env.WORKER_INTERNAL_URL}/health`, { headers: headers(), cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ ok: boolean; sessions: number }>) : null))
      .catch(() => null),
};

/** URL base + headers da API interna — para a rota proxy SSE do chat. */
export function internalStreamConfig(): { url: string; headers: HeadersInit } {
  return { url: `${env.WORKER_INTERNAL_URL}/chat/stream`, headers: headers() };
}

import type { NextRequest } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { getSession } from '@/lib/session';
import { internalStreamConfig } from '@/lib/worker-client';

export const dynamic = 'force-dynamic';

/**
 * Proxy SSE do chat: repassa o stream de inbound da API interna do worker,
 * adicionando o token compartilhado. O browser abre um EventSource nesta rota.
 *
 * Se o worker está fora do ar, devolve um stream SSE que emite um evento
 * `unavailable` (o cliente trata sem quebrar) em vez de um 500.
 */
export async function GET(req: NextRequest) {
  const t = await getTranslations('stream');
  if (!(await getSession())) {
    return new Response(t('unauthorized'), { status: 401 });
  }

  const { url, headers } = internalStreamConfig();

  let upstream: Response;
  try {
    upstream = await fetch(url, { headers, signal: req.signal });
  } catch {
    return sseMessage('unavailable', t('workerOffline'));
  }

  if (!upstream.ok || !upstream.body) {
    return sseMessage('unavailable', t('workerRespondedStatus', { status: upstream.status }));
  }

  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}

/** Um stream SSE de vida curta com um único evento — não estoura no cliente. */
function sseMessage(event: string, detail: string): Response {
  const body = `event: ${event}\ndata: ${JSON.stringify({ detail })}\n\n`;
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  });
}

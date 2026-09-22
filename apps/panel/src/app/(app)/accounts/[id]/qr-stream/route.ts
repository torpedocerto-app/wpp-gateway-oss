import { NextRequest } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { getSession } from '@/lib/session';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Proxy SSE: o browser abre um EventSource nesta rota do painel; ela repassa o
 * stream de QR da API interna do worker, adicionando o token compartilhado que
 * NUNCA vai ao browser.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations('stream');
  if (!(await getSession())) {
    return new Response(t('unauthorized'), { status: 401 });
  }
  const { id } = await params;
  if (!env.INTERNAL_API_TOKEN) {
    return new Response('INTERNAL_API_TOKEN não configurado', { status: 500 });
  }

  const upstream = await fetch(`${env.WORKER_INTERNAL_URL}/accounts/${id}/qr`, {
    headers: { 'x-internal-token': env.INTERNAL_API_TOKEN },
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(`worker QR stream: ${upstream.status}`, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}

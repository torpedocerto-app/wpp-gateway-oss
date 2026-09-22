import { headers } from 'next/headers';

/**
 * Rate limit de janela fixa, em memória do processo. O painel roda como 1
 * container por tenant (docker/compose.app.yml), então um Map basta. Reseta a
 * cada restart/deploy — aceitável para proteção de força bruta em /login e
 * /login/forgot. Redis seria o upgrade se o painel virar multi-réplica.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Registra uma tentativa para `key`. Retorna `ok: false` quando o limite da
 * janela foi excedido, com `retryAfterMs` até a janela reabrir.
 */
export function hit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    sweep(now);
    return { ok: true, retryAfterMs: 0 };
  }

  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterMs: b.resetAt - now };
  }
  return { ok: true, retryAfterMs: 0 };
}

/** Remove buckets expirados de vez em quando (chamado no caminho feliz). */
function sweep(now: number): void {
  if (buckets.size < 512) return;
  for (const [k, v] of buckets) {
    if (now >= v.resetAt) buckets.delete(k);
  }
}

/** IP do cliente — primeiro hop de x-forwarded-for (o Caddy adiciona). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return h.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Proteção anti-SSRF para URLs de webhook (doc 08 §5).
 *
 * A URL é validada no cadastro E resolvida antes de CADA chamada: um domínio
 * pode apontar para IP público no cadastro e ser reapontado para 169.254.169.254
 * (metadata da cloud) depois.
 *
 * `isBlockedIp` é a checagem pura; a resolução DNS acontece no worker.
 */

/** `true` se o host textual é obviamente local (sem precisar resolver DNS). */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  );
}

/**
 * `true` se o IP (v4 ou v6) está em faixa privada, loopback, link-local,
 * metadata da cloud, ou reservada.
 */
export function isBlockedIp(ip: string): boolean {
  // IPv6
  if (ip.includes(':')) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true; // loopback / unspecified
    if (l.startsWith('fe80:')) return true; // link-local
    if (l.startsWith('fc') || l.startsWith('fd')) return true; // unique local (fc00::/7)
    if (l.startsWith('::ffff:')) return isBlockedIp(l.slice(7)); // IPv4-mapped
    return false;
  }

  // IPv4
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // formato inválido → bloqueia por precaução
  }
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast + reserved

  return false;
}

export type WebhookUrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: 'invalid_url' | 'not_https' | 'blocked_hostname' };

/**
 * Validação da URL de webhook no CADASTRO (sem resolver DNS ainda).
 * A checagem de IP resolvido acontece no worker, a cada chamada.
 */
export function checkWebhookUrl(raw: string): WebhookUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (isBlockedHostname(url.hostname)) return { ok: false, reason: 'blocked_hostname' };
  // se o hostname já é um IP literal, checa agora
  if (/^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) {
    if (isBlockedIp(url.hostname.replace(/^\[|\]$/g, ''))) {
      return { ok: false, reason: 'blocked_hostname' };
    }
  }
  return { ok: true, url };
}

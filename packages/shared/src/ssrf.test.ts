import { describe, expect, it } from 'vitest';
import { isBlockedIp, isBlockedHostname, checkWebhookUrl } from './ssrf.js';

describe('isBlockedIp (doc 08 §5)', () => {
  it('bloqueia loopback', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('127.1.2.3')).toBe(true);
    expect(isBlockedIp('::1')).toBe(true);
  });

  it('bloqueia faixas privadas', () => {
    expect(isBlockedIp('10.0.0.5')).toBe(true);
    expect(isBlockedIp('172.16.0.1')).toBe(true);
    expect(isBlockedIp('172.31.255.255')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
  });

  it('bloqueia metadata da cloud (169.254.169.254)', () => {
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('169.254.0.1')).toBe(true);
  });

  it('bloqueia CGNAT, multicast, 0.0.0.0/8', () => {
    expect(isBlockedIp('100.64.0.1')).toBe(true);
    expect(isBlockedIp('224.0.0.1')).toBe(true);
    expect(isBlockedIp('0.0.0.0')).toBe(true);
  });

  it('bloqueia IPv6 link-local e ULA', () => {
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('fd00::1')).toBe(true);
    expect(isBlockedIp('fc00::1')).toBe(true);
  });

  it('bloqueia IPv4-mapeado em IPv6 se o IPv4 for privado', () => {
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:10.0.0.1')).toBe(true);
  });

  it('permite IPs públicos', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('1.1.1.1')).toBe(false);
    expect(isBlockedIp('172.15.0.1')).toBe(false); // fora do /12
    expect(isBlockedIp('172.32.0.1')).toBe(false);
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false); // Cloudflare v6
  });

  it('formato inválido → bloqueia por precaução', () => {
    expect(isBlockedIp('999.1.1.1')).toBe(true);
    expect(isBlockedIp('nonsense')).toBe(true);
  });
});

describe('isBlockedHostname', () => {
  it('bloqueia localhost e domínios internos', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('api.localhost')).toBe(true);
    expect(isBlockedHostname('srv.internal')).toBe(true);
    expect(isBlockedHostname('db.local')).toBe(true);
  });

  it('permite hostnames públicos', () => {
    expect(isBlockedHostname('webhook.example.com')).toBe(false);
    expect(isBlockedHostname('example.com')).toBe(false);
  });
});

describe('checkWebhookUrl (cadastro)', () => {
  it('aceita https com hostname público', () => {
    const r = checkWebhookUrl('https://webhook.example.com/hooks/wpp');
    expect(r.ok).toBe(true);
  });

  it('rejeita http', () => {
    expect(checkWebhookUrl('http://webhook.example.com')).toEqual({
      ok: false,
      reason: 'not_https',
    });
  });

  it('rejeita URL malformada', () => {
    expect(checkWebhookUrl('not a url')).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('rejeita localhost e IP privado literal', () => {
    expect(checkWebhookUrl('https://localhost/x')).toMatchObject({ reason: 'blocked_hostname' });
    expect(checkWebhookUrl('https://192.168.0.1/x')).toMatchObject({ reason: 'blocked_hostname' });
    expect(checkWebhookUrl('https://169.254.169.254/latest/meta-data')).toMatchObject({
      reason: 'blocked_hostname',
    });
  });
});

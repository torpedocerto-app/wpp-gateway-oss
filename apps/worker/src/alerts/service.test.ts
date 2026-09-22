/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertType } from '@wpp/shared';
import { Redis } from 'ioredis';

// mock dos canais — nada sai de verdade
const waSpy = vi.fn(() => Promise.resolve(true));
const emailSpy = vi.fn(() => Promise.resolve(true));
vi.mock('./channels.js', () => ({
  sendViaWhatsApp: waSpy,
  sendViaEmail: emailSpy,
  alertWhatsAppNumber: () => Promise.resolve('573001234567'),
  alertEmail: () => Promise.resolve('a@b.c'),
}));

// redis real (docker) para testar dedup
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
});
vi.mock('../redis.js', () => ({ redis }));

// prisma real (para o canal PANEL escrever account_events) — mas os testes usam
// entityId null, então o PANEL não toca no banco.
const { AlertService } = await import('./service.js');

const fakeManager = { active: new Map() } as any;

beforeEach(async () => {
  waSpy.mockClear();
  emailSpy.mockClear();
  waSpy.mockResolvedValue(true);
  emailSpy.mockResolvedValue(true);
  const keys = await redis.keys('alert:*');
  if (keys.length) await redis.del(...keys);
});

afterEach(async () => {
  const keys = await redis.keys('alert:*');
  if (keys.length) await redis.del(...keys);
});

describe('AlertService (doc 04 §6)', () => {
  it('ACCOUNT_BANNED → tenta WhatsApp primeiro, entrega', async () => {
    const svc = new AlertService(fakeManager);
    const ok = await svc.fire(AlertType.ACCOUNT_BANNED, 'Conta X banida', 'corpo', {
      entityId: null,
    });
    expect(ok).toBe(true);
    expect(waSpy).toHaveBeenCalledTimes(1);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('WhatsApp falha → cai para e-mail', async () => {
    waSpy.mockResolvedValue(false);
    const svc = new AlertService(fakeManager);
    const ok = await svc.fire(AlertType.ACCOUNT_BANNED, 't', 'b', { entityId: null });
    expect(ok).toBe(true);
    expect(waSpy).toHaveBeenCalledTimes(1);
    expect(emailSpy).toHaveBeenCalledTimes(1);
  });

  it('dedup: 2º disparo do mesmo (type, entityId) em 1h é suprimido', async () => {
    const svc = new AlertService(fakeManager);
    const first = await svc.fire(AlertType.ACCOUNT_BANNED, 't', 'b', { entityId: 'acc-1' });
    const second = await svc.fire(AlertType.ACCOUNT_BANNED, 't', 'b', { entityId: 'acc-1' });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(waSpy).toHaveBeenCalledTimes(1); // só o primeiro
  });

  it('dedup é por entidade: contas diferentes não se suprimem', async () => {
    const svc = new AlertService(fakeManager);
    await svc.fire(AlertType.ACCOUNT_BANNED, 't', 'b', { entityId: 'acc-1' });
    const other = await svc.fire(AlertType.ACCOUNT_BANNED, 't', 'b', { entityId: 'acc-2' });
    expect(other).toBe(true);
    expect(waSpy).toHaveBeenCalledTimes(2);
  });

  it('POOL_EMPTY → NÃO tenta WhatsApp (0 contas), vai direto para e-mail', async () => {
    const svc = new AlertService(fakeManager);
    await svc.fire(AlertType.POOL_EMPTY, 'Pool vazio', 'b', { entityId: null });
    expect(waSpy).not.toHaveBeenCalled();
    expect(emailSpy).toHaveBeenCalledTimes(1);
  });

  it('POOL_EMPTY marca estado de escalonamento', async () => {
    const svc = new AlertService(fakeManager);
    await svc.fire(AlertType.POOL_EMPTY, 't', 'b', { entityId: null });
    expect(await redis.exists('alert:escalate:POOL_EMPTY')).toBe(1);
    await svc.clearEscalation(AlertType.POOL_EMPTY);
    expect(await redis.exists('alert:escalate:POOL_EMPTY')).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from './index.js';
import {
  getSetting,
  getSettingOr,
  setSetting,
  deleteSetting,
  listSettings,
  clearSettingsCache,
} from './settings.js';

const KEY = 'test_alert_number';

beforeEach(async () => {
  clearSettingsCache();
  await prisma.setting.deleteMany({ where: { key: KEY } });
});
afterEach(async () => {
  await prisma.setting.deleteMany({ where: { key: KEY } });
});

describe('settings (Fase 5)', () => {
  it('getSetting → null quando não existe', async () => {
    expect(await getSetting(KEY)).toBeNull();
  });

  it('getSettingOr → fallback quando não existe, valor da tabela quando existe', async () => {
    expect(await getSettingOr(KEY, 'default-123')).toBe('default-123');
    await setSetting(KEY, '573001234567');
    clearSettingsCache();
    expect(await getSettingOr(KEY, 'default-123')).toBe('573001234567');
  });

  it('setSetting faz upsert e invalida o cache', async () => {
    await setSetting(KEY, 'v1');
    expect(await getSetting(KEY)).toBe('v1');
    await setSetting(KEY, 'v2');
    expect(await getSetting(KEY)).toBe('v2'); // cache invalidado pelo setSetting
  });

  it('deleteSetting volta ao fallback', async () => {
    await setSetting(KEY, 'x');
    await deleteSetting(KEY);
    clearSettingsCache();
    expect(await getSetting(KEY)).toBeNull();
    expect(await getSettingOr(KEY, 'fb')).toBe('fb');
  });

  it('valor vazio na tabela → getSettingOr usa o fallback', async () => {
    await setSetting(KEY, '   ');
    clearSettingsCache();
    expect(await getSettingOr(KEY, 'fb')).toBe('fb');
  });

  it('listSettings inclui a chave gravada', async () => {
    await setSetting(KEY, 'listed');
    const all = await listSettings();
    expect(all.some((s) => s.key === KEY && s.value === 'listed')).toBe(true);
  });
});

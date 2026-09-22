import { prisma } from './index.js';

/**
 * Configuração chave-valor editável em runtime (tabela `settings`, Fase 5).
 *
 * A tabela sobrescreve o valor do `.env` quando a chave existe. Leitura é
 * cacheada em memória do processo por poucos segundos — mudanças via CLI/painel
 * refletem quase imediatamente sem exigir restart.
 */

export const SETTING_KEYS = {
  ALERT_WHATSAPP_NUMBER: 'alert_whatsapp_number',
  ALERT_EMAIL: 'alert_email',
} as const;
export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { value: string | null; at: number }>();

/** Lê um setting da tabela. `null` se não existe. Cache de 5s. */
export async function getSetting(key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
  const value = row?.value ?? null;
  cache.set(key, { value, at: Date.now() });
  return value;
}

/**
 * Lê um setting com fallback para um default (tipicamente vindo do `.env`).
 * O valor da tabela vence quando presente e não-vazio.
 */
export async function getSettingOr(key: string, fallback: string): Promise<string> {
  const v = await getSetting(key);
  return v && v.trim() ? v : fallback;
}

/** Grava/atualiza um setting. Invalida o cache local imediatamente. */
export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  cache.delete(key);
}

/** Remove um setting (volta a valer o default do .env). */
export async function deleteSetting(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } });
  cache.delete(key);
}

/** Lista todos os settings — para o painel (Fase 6). */
export async function listSettings(): Promise<Array<{ key: string; value: string; updatedAt: Date }>> {
  return prisma.setting.findMany({ orderBy: { key: 'asc' } });
}

/** Zera o cache local (útil em testes). */
export function clearSettingsCache(): void {
  cache.clear();
}

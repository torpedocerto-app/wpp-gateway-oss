'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { SETTING_KEYS, setSetting, deleteSetting } from '@wpp/database';
import { requireSession } from '@/lib/auth';

export async function saveAlertNumberAction(
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  await requireSession();
  const t = await getTranslations('actions.settings');
  const raw = String(formData.get('alertNumber') ?? '').trim();

  if (raw === '') {
    await deleteSetting(SETTING_KEYS.ALERT_WHATSAPP_NUMBER);
    revalidatePath('/settings');
    return { ok: true };
  }
  if (!/^\d{10,15}$/.test(raw)) {
    return { error: t('e164Format') };
  }
  await setSetting(SETTING_KEYS.ALERT_WHATSAPP_NUMBER, raw);
  revalidatePath('/settings');
  return { ok: true };
}

export async function saveAlertEmailAction(
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  await requireSession();
  const t = await getTranslations('actions.settings');
  const raw = String(formData.get('alertEmail') ?? '').trim();
  if (raw === '') {
    await deleteSetting(SETTING_KEYS.ALERT_EMAIL);
    revalidatePath('/settings');
    return { ok: true };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
    return { error: t('invalidEmail') };
  }
  await setSetting(SETTING_KEYS.ALERT_EMAIL, raw);
  revalidatePath('/settings');
  return { ok: true };
}

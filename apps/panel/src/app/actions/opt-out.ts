'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { isSuppressed, suppressContact, unsuppressContact } from '@wpp/database';
import { normalizePhone } from '@wpp/shared';
import { requireSession } from '@/lib/auth';

export async function reactivateContactAction(phoneNumber: string): Promise<void> {
  await requireSession();
  await unsuppressContact(phoneNumber);
  revalidatePath('/opt-out');
}

export async function suppressContactAction(
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  await requireSession();
  const t = await getTranslations('actions.optOut');
  const raw = String(formData.get('phone') ?? '').trim();

  let phone: string;
  try {
    phone = normalizePhone(raw).e164;
  } catch {
    return { error: t('invalidPhone') };
  }

  if (await isSuppressed(phone)) {
    return { error: t('alreadySuppressed') };
  }

  await suppressContact(phone, 'manual');
  revalidatePath('/opt-out');
  return { ok: true };
}

'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { setAdminLocale } from '@wpp/database';
import { requireSession } from '@/lib/auth';
import { isLocale } from '@/i18n/routing';

/** Troca o idioma do usuário logado: persiste no banco + cookie + revalida. */
export async function setMyLocaleAction(locale: string): Promise<void> {
  const me = await requireSession();
  if (!isLocale(locale)) return;
  await setAdminLocale(me.userId, locale);
  (await cookies()).set('NEXT_LOCALE', locale, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/', 'layout');
}

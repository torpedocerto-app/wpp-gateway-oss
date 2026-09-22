'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/auth';
import { workerApi } from '@/lib/worker-client';

export async function createAccountAction(formData: FormData): Promise<{ accountId?: string; error?: string }> {
  await requireSession();
  const t = await getTranslations('actions.accounts');
  const label = String(formData.get('label') ?? '').trim();
  if (!label) return { error: t('nameRequired') };
  try {
    const r = await workerApi.createAccount(label);
    revalidatePath('/accounts');
    return { accountId: r.accountId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t('genericFailure') };
  }
}

export async function pauseAccountAction(id: string): Promise<void> {
  await requireSession();
  await workerApi.pauseAccount(id);
  revalidatePath('/accounts');
  revalidatePath(`/accounts/${id}`);
}

export async function resumeAccountAction(id: string): Promise<void> {
  await requireSession();
  await workerApi.resumeAccount(id);
  revalidatePath('/accounts');
  revalidatePath(`/accounts/${id}`);
}

export async function reconnectAccountAction(id: string): Promise<void> {
  await requireSession();
  await workerApi.reconnectAccount(id);
  revalidatePath(`/accounts/${id}`);
}

export async function removeAccountAction(id: string): Promise<void> {
  await requireSession();
  await workerApi.removeAccount(id);
  revalidatePath('/accounts');
}

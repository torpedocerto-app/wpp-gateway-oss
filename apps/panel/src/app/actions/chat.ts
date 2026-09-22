'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { normalizePhone } from '@wpp/shared';
import { requireSession } from '@/lib/auth';
import { workerApi } from '@/lib/worker-client';
import { markConversationRead } from '@/lib/chat';

export interface SendResult {
  ok: boolean;
  error?: string;
  ack?: string;
}

/** Envia uma mensagem de chat por uma conta específica (sem fila, sem projeto). */
export async function sendChatMessageAction(
  accountId: string,
  to: string,
  text: string,
): Promise<SendResult> {
  await requireSession();
  const t = await getTranslations('actions.chat');
  const clean = text.trim();
  if (!clean) return { ok: false, error: t('emptyMessage') };

  let phone: string;
  try {
    phone = normalizePhone(to).e164;
  } catch {
    return { ok: false, error: t('invalidNumber') };
  }

  try {
    const r = await workerApi.chatSend(accountId, phone, clean);
    revalidatePath(`/chat/${encodeURIComponent(phone)}`);
    revalidatePath('/chat');
    return { ok: true, ack: r.ack };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t('genericFailure') };
  }
}

/** Emite "digitando" pela conta enquanto o admin digita. Best-effort. */
export async function typingAction(
  accountId: string,
  to: string,
  state: 'composing' | 'paused',
): Promise<void> {
  await requireSession();
  try {
    const phone = normalizePhone(to).e164;
    await workerApi.chatTyping(accountId, phone, state);
  } catch {
    // ignora
  }
}

/** Marca a conversa como lida (ao abrir o thread). */
export async function markReadAction(contact: string, accountId: string): Promise<void> {
  await requireSession();
  await markConversationRead(contact, accountId);
  revalidatePath('/chat');
}

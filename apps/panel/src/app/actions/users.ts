'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import {
  prisma,
  countActiveAdmins,
  createInvitedAdmin,
  setAdminDisabled,
  deleteAdmin,
  createAdminToken,
  invalidateUserTokens,
  needsSetup,
} from '@wpp/database';
import { generateToken, isEmailConfigured, sendEmail, inviteEmail, INVITE_TTL_MS } from '@wpp/email';
import { requireSession, verifyPassword, setPassword } from '@/lib/auth';
import { env } from '@/lib/env';

type Result = { error?: string; ok?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function sendInvite(
  userId: string,
  email: string,
  inviterEmail: string,
  locale: string,
): Promise<void> {
  const { raw, hash } = generateToken();
  await createAdminToken({
    userId,
    purpose: 'INVITE',
    tokenHash: hash,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  const url = `${env.PANEL_PUBLIC_URL}/login/setup?token=${raw}`;
  await sendEmail({
    to: email,
    ...inviteEmail({ brand: env.PANEL_BRAND_NAME, url, inviterEmail, locale }),
  });
}

/** Convida um novo usuário: cria a linha (sem senha) e manda o email de convite. */
export async function inviteUserAction(formData: FormData): Promise<Result> {
  const me = await requireSession();
  const t = await getTranslations('actions.users');
  if (!isEmailConfigured()) return { error: t('smtpRequiredToInvite') };

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const name = String(formData.get('name') ?? '').trim() || null;
  if (!EMAIL_RE.test(email)) return { error: t('invalidEmail') };

  let userId: string;
  try {
    ({ id: userId } = await createInvitedAdmin({
      email,
      name,
      invitedById: me.userId,
      locale: me.locale,
    }));
  } catch {
    return { error: t('emailAlreadyRegistered') };
  }
  await sendInvite(userId, email, me.email, me.locale);
  revalidatePath('/users');
  return { ok: t('inviteSent') };
}

/** Reenvia o convite (só se o usuário ainda não definiu senha). */
export async function resendInviteAction(formData: FormData): Promise<Result> {
  const me = await requireSession();
  const t = await getTranslations('actions.users');
  if (!isEmailConfigured()) return { error: t('smtpRequiredToResend') };

  const userId = String(formData.get('userId') ?? '');
  const user = await prisma.adminUser.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true, locale: true },
  });
  if (!user || !needsSetup(user.passwordHash)) {
    return { error: t('userAlreadyCompleted') };
  }
  await invalidateUserTokens(userId); // o token antigo deixa de valer
  await sendInvite(userId, user.email, me.email, user.locale);
  revalidatePath('/users');
  return { ok: t('inviteResent') };
}

/** Ativa/desativa um usuário. Não permite desativar a si mesmo nem o último ativo. */
export async function setUserDisabledAction(formData: FormData): Promise<Result> {
  const me = await requireSession();
  const t = await getTranslations('actions.users');
  const userId = String(formData.get('userId') ?? '');
  const disabled = String(formData.get('disabled') ?? '') === '1';

  if (userId === me.userId) return { error: t('cannotDisableSelf') };
  if (disabled && (await countActiveAdmins()) <= 1) {
    return { error: t('cannotDisableLastActive') };
  }
  await setAdminDisabled(userId, disabled);
  revalidatePath('/users');
  return { ok: disabled ? t('userDisabled') : t('userReactivated') };
}

/** Remove um usuário. Não permite remover a si mesmo nem o último ativo. */
export async function deleteUserAction(formData: FormData): Promise<Result> {
  const me = await requireSession();
  const t = await getTranslations('actions.users');
  const userId = String(formData.get('userId') ?? '');
  if (userId === me.userId) return { error: t('cannotRemoveSelf') };

  const target = await prisma.adminUser.findUnique({
    where: { id: userId },
    select: { disabledAt: true },
  });
  if (target && !target.disabledAt && (await countActiveAdmins()) <= 1) {
    return { error: t('cannotRemoveLastActive') };
  }
  await deleteAdmin(userId);
  revalidatePath('/users');
  return { ok: t('userRemoved') };
}

/** Troca a senha do próprio usuário logado. */
export async function changeMyPasswordAction(formData: FormData): Promise<Result> {
  const me = await requireSession();
  const t = await getTranslations('actions.users');
  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (!(await verifyPassword(me.userId, current))) return { error: t('currentPasswordWrong') };
  if (next.length < 12) return { error: t('newPasswordTooShort') };
  if (next !== confirm) return { error: t('passwordMismatch') };

  await setPassword(me.userId, next);
  await invalidateUserTokens(me.userId);
  return { ok: t('passwordChanged') };
}

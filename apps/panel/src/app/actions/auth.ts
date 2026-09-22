'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import {
  createAdminToken,
  findUsableAdminToken,
  consumeAdminToken,
  lastResetTokenAt,
  invalidateUserTokens,
  getAdminById,
} from '@wpp/database';
import {
  generateToken,
  hashToken,
  isEmailConfigured,
  sendEmail,
  resetPasswordEmail,
  RESET_TTL_MS,
} from '@wpp/email';
import {
  getUserByEmail,
  getBootstrapAdmin,
  BootstrapError,
  needsSetup,
  verifyPassword,
  verifyTotp,
  dummyVerify,
  setPassword,
  provisionTotp,
  confirmTotp,
  touchLogin,
} from '@/lib/auth';
import { createSession, destroySession } from '@/lib/session';
import { hit, clientIp } from '@/lib/rate-limit';
import { isLocale } from '@/i18n/routing';
import { env } from '@/lib/env';

export interface ActionState {
  error?: string;
  ok?: string;
  /** para o passo de setup do TOTP: otpauth URI para gerar o QR */
  otpauth?: string;
}

/** Após um login/setup bem-sucedido, alinha o cookie de locale ao do usuário. */
async function syncLocaleCookie(userId: string): Promise<void> {
  const user = await getAdminById(userId);
  if (user && isLocale(user.locale)) {
    (await cookies()).set('NEXT_LOCALE', user.locale, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
}

/** Login: email + senha + TOTP. */
export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations('actions.auth');
  const ip = await clientIp();
  if (!hit(`login:${ip}`, 10, 5 * 60_000).ok) {
    return { error: t('tooManyAttempts') };
  }

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const totp = String(formData.get('totp') ?? '');

  const user = await getUserByEmail(email);
  if (!user || user.disabledAt || needsSetup(user.passwordHash)) {
    await dummyVerify(password); // achata o tempo de resposta
    return { error: t('invalidCredentials') };
  }
  if (!(await verifyPassword(user.id, password))) {
    return { error: t('invalidCredentials') };
  }
  if (!user.totpEnabled || !(await verifyTotp(user.id, totp))) {
    return { error: t('invalidCredentials') };
  }

  await touchLogin(user.id);
  await createSession(user.id);
  await syncLocaleCookie(user.id);
  redirect('/');
}

/**
 * Resolve o usuário-alvo do fluxo de setup: pelo token de convite (INVITE) se
 * houver, senão o único usuário pendente do tenant (primeiro acesso).
 */
async function resolveSetupTarget(
  token: string,
  t: (key: string) => string,
): Promise<{ userId: string; email: string; fromInvite: boolean } | { error: string }> {
  if (token) {
    const row = await findUsableAdminToken(hashToken(token), 'INVITE');
    if (!row || row.user.disabledAt) return { error: t('inviteInvalid') };
    return { userId: row.userId, email: row.user.email, fromInvite: true };
  }
  try {
    const boot = await getBootstrapAdmin();
    return { userId: boot.id, email: boot.email, fromInvite: false };
  } catch (e) {
    const setupT = await getTranslations('setup');
    if (e instanceof BootstrapError) return { error: setupT(e.code) };
    return { error: setupT('noPendingSetup') };
  }
}

/** Passo 1 do setup: define a senha e provisiona o TOTP. */
export async function setupPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions.auth');
  const token = String(formData.get('token') ?? '');
  const target = await resolveSetupTarget(token, t);
  if ('error' in target) return { error: target.error };

  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < 12) return { error: t('passwordTooShort') };
  if (password !== confirm) return { error: t('passwordMismatch') };

  await setPassword(target.userId, password);
  const { otpauth } = await provisionTotp(target.userId, target.email);
  return { ok: t('passwordSetNext2fa'), otpauth };
}

/** Passo 2 do setup: confirma o TOTP com o primeiro código. */
export async function setupTotpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations('actions.auth');
  const token = String(formData.get('token') ?? '');
  const target = await resolveSetupTarget(token, t);
  if ('error' in target) return { error: target.error };

  const code = String(formData.get('totp') ?? '');
  if (!(await confirmTotp(target.userId, code))) {
    return { error: t('invalidTotpTryNext') };
  }
  if (token) {
    const row = await findUsableAdminToken(hashToken(token), 'INVITE');
    if (row) await consumeAdminToken(row.id);
    await invalidateUserTokens(target.userId);
  }
  await touchLogin(target.userId);
  await createSession(target.userId);
  await syncLocaleCookie(target.userId);
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/login');
}

/** "Esqueci a senha": envia um link de reset. Nunca revela se o email existe. */
export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions.auth');
  const ip = await clientIp();
  if (!hit(`forgot:${ip}`, 5, 15 * 60_000).ok) {
    return { error: t('tooManyAttemptsLater') };
  }

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const user = await getUserByEmail(email);

  if (user && !user.disabledAt && !needsSetup(user.passwordHash)) {
    const last = await lastResetTokenAt(user.id);
    const throttled = last && Date.now() - last.getTime() < 60_000;
    if (!throttled) {
      const { raw, hash } = generateToken();
      await createAdminToken({
        userId: user.id,
        purpose: 'RESET',
        tokenHash: hash,
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      });
      const url = `${env.PANEL_PUBLIC_URL}/login/reset/${raw}`;
      if (isEmailConfigured()) {
        await sendEmail({
          to: user.email,
          ...resetPasswordEmail({ brand: env.PANEL_BRAND_NAME, url, locale: user.locale }),
        });
      } else {
        console.error('[reset] SMTP não configurado — link não enviado:', url);
      }
    }
  }

  return { ok: t('resetMaybeSent') };
}

/** Aplica a nova senha a partir de um token de reset válido. */
export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions.auth');
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < 12) return { error: t('passwordTooShort') };
  if (password !== confirm) return { error: t('passwordMismatch') };

  const row = await findUsableAdminToken(hashToken(token), 'RESET');
  if (!row || row.user.disabledAt) {
    return { error: t('resetLinkInvalid') };
  }

  await setPassword(row.userId, password);
  await consumeAdminToken(row.id);
  await invalidateUserTokens(row.userId);
  // Não cria sessão — o 2FA ainda é exigido no próximo login.
  redirect('/login?reset=1');
}

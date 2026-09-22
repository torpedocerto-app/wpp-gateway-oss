'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { loginAction, type ActionState } from '@/app/actions/auth';

const initial: ActionState = {};

export function LoginForm() {
  const t = useTranslations('login');
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <form action={action}>
      <label htmlFor="email">{t('email')}</label>
      <input id="email" name="email" type="email" autoComplete="username" required />

      <label htmlFor="password">{t('password')}</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />

      <label htmlFor="totp">{t('totp')}</label>
      <input
        id="totp"
        name="totp"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        required
      />

      {state.error && <div className="error">{state.error}</div>}

      <button className="primary mt-16" type="submit" disabled={pending} style={{ width: '100%' }}>
        {pending ? t('signingIn') : t('signIn')}
      </button>

      <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>
        <Link href="/login/forgot">{t('forgotPassword')}</Link>
      </p>
    </form>
  );
}

'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { requestPasswordResetAction, type ActionState } from '@/app/actions/auth';

const initial: ActionState = {};

export function ForgotForm() {
  const t = useTranslations('login');
  const [state, action, pending] = useActionState(requestPasswordResetAction, initial);

  return (
    <form action={action}>
      <label htmlFor="email">{t('accountEmail')}</label>
      <input id="email" name="email" type="email" autoComplete="username" required />

      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="ok">{state.ok}</div>}

      <button className="primary mt-16" type="submit" disabled={pending} style={{ width: '100%' }}>
        {pending ? t('sending') : t('sendRecoveryLink')}
      </button>
    </form>
  );
}

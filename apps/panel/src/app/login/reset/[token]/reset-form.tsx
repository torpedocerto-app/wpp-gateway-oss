'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { resetPasswordAction, type ActionState } from '@/app/actions/auth';

const initial: ActionState = {};

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations('login');
  const [state, action, pending] = useActionState(resetPasswordAction, initial);

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <label htmlFor="password">{t('newPassword')}</label>
      <input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" />
      <label htmlFor="confirm">{t('confirmPassword')}</label>
      <input id="confirm" name="confirm" type="password" required minLength={12} autoComplete="new-password" />

      {state.error && <div className="error">{state.error}</div>}

      <button className="primary mt-16" type="submit" disabled={pending} style={{ width: '100%' }}>
        {pending ? t('saving') : t('resetPassword')}
      </button>
    </form>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { changeMyPasswordAction } from '@/app/actions/users';

export function ChangeMyPasswordForm() {
  const t = useTranslations('users');
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);

  return (
    <form
      action={async (fd) => {
        setMsg(await changeMyPasswordAction(fd));
      }}
      style={{ marginTop: 8 }}
    >
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input
          name="currentPassword"
          type="password"
          placeholder={t('currentPassword')}
          autoComplete="current-password"
          required
          style={{ width: 180 }}
        />
        <input
          name="newPassword"
          type="password"
          placeholder={t('newPassword')}
          autoComplete="new-password"
          minLength={12}
          required
          style={{ width: 180 }}
        />
        <input
          name="confirm"
          type="password"
          placeholder={t('confirmPassword')}
          autoComplete="new-password"
          minLength={12}
          required
          style={{ width: 150 }}
        />
        <button className="primary" type="submit">
          {t('changePassword')}
        </button>
      </div>
      {msg?.error && <div className="error">{msg.error}</div>}
      {msg?.ok && <div className="ok">{msg.ok}</div>}
    </form>
  );
}

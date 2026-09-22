'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { resendInviteAction, setUserDisabledAction, deleteUserAction } from '@/app/actions/users';

export function UserRowActions({
  userId,
  isSelf,
  disabled,
  pendingInvite,
  smtpOk,
}: {
  userId: string;
  isSelf: boolean;
  disabled: boolean;
  pendingInvite: boolean;
  smtpOk: boolean;
}) {
  const t = useTranslations('users');
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);

  if (isSelf) {
    return <span className="muted">{t('you')}</span>;
  }

  const field = (name: string, value: string) => (
    <input type="hidden" name={name} value={value} />
  );

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {pendingInvite && (
        <form action={async (fd) => setMsg(await resendInviteAction(fd))}>
          {field('userId', userId)}
          <button type="submit" disabled={!smtpOk}>
            {t('resendInvite')}
          </button>
        </form>
      )}

      <form action={async (fd) => setMsg(await setUserDisabledAction(fd))}>
        {field('userId', userId)}
        {field('disabled', disabled ? '0' : '1')}
        <button type="submit">{disabled ? t('reactivate') : t('disable')}</button>
      </form>

      <form action={async (fd) => setMsg(await deleteUserAction(fd))}>
        {field('userId', userId)}
        <button className="danger" type="submit">
          {t('remove')}
        </button>
      </form>

      {msg?.error && <span className="error">{msg.error}</span>}
      {msg?.ok && <span className="ok">{msg.ok}</span>}
    </div>
  );
}

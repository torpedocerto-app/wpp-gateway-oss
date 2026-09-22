'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { inviteUserAction } from '@/app/actions/users';

export function InviteUserForm({ disabled }: { disabled: boolean }) {
  const t = useTranslations('users');
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);

  return (
    <form
      action={async (fd) => {
        setMsg(await inviteUserAction(fd));
      }}
    >
      <div className="row">
        <input
          name="email"
          type="email"
          placeholder={t('invitePlaceholderEmail')}
          required
          style={{ width: 260 }}
        />
        <input
          name="name"
          type="text"
          placeholder={t('invitePlaceholderName')}
          style={{ width: 180 }}
        />
        <button className="primary" type="submit" disabled={disabled}>
          {t('invite')}
        </button>
      </div>
      {msg?.error && <div className="error">{msg.error}</div>}
      {msg?.ok && <div className="ok">{msg.ok}</div>}
    </form>
  );
}

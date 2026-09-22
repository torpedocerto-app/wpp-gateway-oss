'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function NewChatButton({
  accounts,
}: {
  accounts: Array<{ id: string; label: string; phoneNumber: string | null }>;
}) {
  const t = useTranslations('chat');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [number, setNumber] = useState('');

  if (accounts.length === 0) {
    return <span className="muted">{t('noAccountsForNewChat')}</span>;
  }

  function start() {
    const digits = number.replace(/\D/g, '');
    if (!digits || !accountId) return;
    router.push(`/chat/+${digits}?account=${accountId}&new=1`);
  }

  if (!open) {
    return (
      <button className="primary" onClick={() => setOpen(true)}>
        {t('newConversation')}
      </button>
    );
  }

  return (
    <div className="card" style={{ position: 'absolute', right: 32, zIndex: 10, width: 320 }}>
      <h3 style={{ marginTop: 0 }}>{t('newConversationTitle')}</h3>
      <p className="muted" style={{ fontSize: 12 }}>
        {t('newConversationWarning')}
      </p>
      <label>{t('accountLabel')}</label>
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label} {a.phoneNumber ? `(+${a.phoneNumber})` : ''}
          </option>
        ))}
      </select>
      <label>{t('contactNumberLabel')}</label>
      <input
        placeholder="573001234567"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
      />
      <div className="row mt-16">
        <button className="primary" onClick={start} disabled={!number.replace(/\D/g, '')}>
          {t('openConversation')}
        </button>
        <button onClick={() => setOpen(false)}>{t('cancel')}</button>
      </div>
    </div>
  );
}

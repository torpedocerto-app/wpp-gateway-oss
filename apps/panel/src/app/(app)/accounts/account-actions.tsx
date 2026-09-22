'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  pauseAccountAction,
  resumeAccountAction,
  reconnectAccountAction,
  removeAccountAction,
} from '@/app/actions/accounts';

export function AccountActions({
  id,
  isEnabled,
  status,
  label,
}: {
  id: string;
  isEnabled: boolean;
  status: string;
  label: string;
}) {
  const t = useTranslations('accounts');
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');

  const banned = status === 'BANNED';

  return (
    <div className="row">
      {!banned &&
        (isEnabled ? (
          <button
            disabled={pending}
            onClick={() => start(() => pauseAccountAction(id))}
            title={t('pauseTitle')}
          >
            {t('pause')}
          </button>
        ) : (
          <button disabled={pending} onClick={() => start(() => resumeAccountAction(id))}>
            {t('resume')}
          </button>
        ))}
      {!banned && (
        <button
          disabled={pending}
          onClick={() => start(() => reconnectAccountAction(id))}
          title={t('reconnectTitle')}
        >
          {t('reconnect')}
        </button>
      )}

      {confirming ? (
        <span className="row">
          <input
            style={{ width: 140 }}
            placeholder={t('typePrompt', { label })}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <button
            className="danger"
            disabled={typed !== label || pending}
            title={t('deleteForeverTitle')}
            onClick={() =>
              start(async () => {
                await removeAccountAction(id);
                setConfirming(false);
                setTyped('');
              })
            }
          >
            {t('deleteForever')}
          </button>
          <button onClick={() => setConfirming(false)}>{t('cancel')}</button>
        </span>
      ) : (
        <button className="danger" onClick={() => setConfirming(true)} title={t('removeTitle')}>
          {t('remove')}
        </button>
      )}
    </div>
  );
}

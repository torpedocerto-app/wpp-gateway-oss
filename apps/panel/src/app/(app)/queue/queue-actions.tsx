'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  pauseQueueAction,
  resumeQueueAction,
  retryFailedAction,
  cleanCompletedAction,
} from '@/app/actions/queue';

export function QueueActions({ paused, failedCount }: { paused: boolean; failedCount: number }) {
  const t = useTranslations('queue');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="row">
      {msg && <span className="muted">{msg}</span>}
      {paused ? (
        <button disabled={pending} onClick={() => start(() => resumeQueueAction())}>
          {t('resumeQueue')}
        </button>
      ) : (
        <button disabled={pending} onClick={() => start(() => pauseQueueAction())}>
          {t('pause')}
        </button>
      )}
      {failedCount > 0 && (
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await retryFailedAction();
              setMsg(t('retriedMsg', { n: r.retried }));
            })
          }
        >
          {t('retryN', { n: failedCount })}
        </button>
      )}
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await cleanCompletedAction();
            setMsg(t('removedMsg', { n: r.removed }));
          })
        }
      >
        {t('cleanCompleted')}
      </button>
    </div>
  );
}

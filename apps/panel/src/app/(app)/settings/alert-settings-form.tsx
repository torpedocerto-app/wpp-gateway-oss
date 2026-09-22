'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { saveAlertNumberAction, saveAlertEmailAction } from '@/app/actions/settings';

export function AlertSettingsForm({
  currentNumber,
  envNumber,
  currentEmail,
  envEmail,
}: {
  currentNumber: string | null;
  envNumber: string;
  currentEmail: string | null;
  envEmail: string;
}) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const [numMsg, setNumMsg] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [mailMsg, setMailMsg] = useState<{ error?: string; ok?: boolean } | null>(null);

  return (
    <>
      <form action={async (fd) => setNumMsg(await saveAlertNumberAction(fd))}>
        <label htmlFor="alertNumber">{t('alertNumberLabel', { env: envNumber })}</label>
        <div className="row">
          <input
            id="alertNumber"
            name="alertNumber"
            defaultValue={currentNumber ?? ''}
            placeholder={envNumber}
            style={{ width: 240 }}
          />
          <button className="primary" type="submit">
            {tCommon('save')}
          </button>
        </div>
        {numMsg?.error && <div className="error">{numMsg.error}</div>}
        {numMsg?.ok && <div className="ok">{tCommon('saved')}</div>}
        {currentNumber && (
          <p className="muted" style={{ fontSize: 12 }}>
            {t('currentOverridesEnv', { value: currentNumber })}
          </p>
        )}
      </form>

      <form
        action={async (fd) => setMailMsg(await saveAlertEmailAction(fd))}
        style={{ marginTop: 20 }}
      >
        <label htmlFor="alertEmail">{t('alertEmailLabel', { env: envEmail })}</label>
        <div className="row">
          <input
            id="alertEmail"
            name="alertEmail"
            type="email"
            defaultValue={currentEmail ?? ''}
            placeholder={envEmail}
            style={{ width: 280 }}
          />
          <button className="primary" type="submit">
            {tCommon('save')}
          </button>
        </div>
        {mailMsg?.error && <div className="error">{mailMsg.error}</div>}
        {mailMsg?.ok && <div className="ok">{tCommon('saved')}</div>}
      </form>
    </>
  );
}

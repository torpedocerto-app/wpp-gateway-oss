'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { setupPasswordAction, setupTotpAction, type ActionState } from '@/app/actions/auth';

const initial: ActionState = {};

export function SetupFlow({ token }: { token?: string }) {
  const t = useTranslations('setup');
  const [pwState, pwAction, pwPending] = useActionState(setupPasswordAction, initial);
  const [totpState, totpAction, totpPending] = useActionState(setupTotpAction, initial);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const showTotpStep = Boolean(pwState.otpauth);

  useEffect(() => {
    if (pwState.otpauth) {
      void QRCode.toDataURL(pwState.otpauth, { width: 200 }).then(setQrDataUrl);
    }
  }, [pwState.otpauth]);

  if (!showTotpStep) {
    return (
      <form action={pwAction}>
        {token && <input type="hidden" name="token" value={token} />}
        <label htmlFor="password">{t('newPassword')}</label>
        <input id="password" name="password" type="password" required minLength={12} />
        <label htmlFor="confirm">{t('confirmPassword')}</label>
        <input id="confirm" name="confirm" type="password" required minLength={12} />
        {pwState.error && <div className="error">{pwState.error}</div>}
        <button className="primary mt-16" type="submit" disabled={pwPending} style={{ width: '100%' }}>
          {pwPending ? t('saving') : t('setPassword')}
        </button>
      </form>
    );
  }

  return (
    <form action={totpAction}>
      {token && <input type="hidden" name="token" value={token} />}
      {qrDataUrl ? (
        <>
          <p className="muted">{t('scanAuthenticator')}</p>
          {}
          <img src={qrDataUrl} alt={t('qrAlt')} style={{ display: 'block', margin: '12px auto' }} />
        </>
      ) : (
        <p className="muted">{t('generatingQr')}</p>
      )}
      <label htmlFor="totp">{t('enterCode')}</label>
      <input id="totp" name="totp" inputMode="numeric" placeholder="000000" required />
      {totpState.error && <div className="error">{totpState.error}</div>}
      <button className="primary mt-16" type="submit" disabled={totpPending} style={{ width: '100%' }}>
        {totpPending ? t('confirming') : t('activate2faAndEnter')}
      </button>
    </form>
  );
}

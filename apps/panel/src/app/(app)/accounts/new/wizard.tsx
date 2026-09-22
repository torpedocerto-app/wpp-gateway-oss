'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { createAccountAction } from '@/app/actions/accounts';

type Step = 'name' | 'qr' | 'connected' | 'error';

export function NewAccountWizard({ warmupDays }: { warmupDays: number }) {
  const t = useTranslations('accounts');
  const tActions = useTranslations('actions.accounts');
  const router = useRouter();
  const [step, setStep] = useState<Step>('name');
  const [label, setLabel] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrAttempt, setQrAttempt] = useState(0);
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // abre o SSE quando entra no passo 'qr'
  useEffect(() => {
    if (step !== 'qr' || !accountId) return;
    const es = new EventSource(`/accounts/${accountId}/qr-stream`);
    esRef.current = es;

    es.addEventListener('qr', (e) => {
      const { qr, attempt } = JSON.parse((e as MessageEvent).data) as { qr: string; attempt: number };
      setQrAttempt(attempt);
      void QRCode.toDataURL(qr, { width: 260 }).then(setQrDataUrl);
    });
    es.addEventListener('connected', (e) => {
      const { phoneNumber } = JSON.parse((e as MessageEvent).data) as { phoneNumber: string };
      setPhone(phoneNumber);
      setStep('connected');
      es.close();
    });
    es.addEventListener('failed', (e) => {
      const { reason } = JSON.parse((e as MessageEvent).data) as { reason: string };
      setError(t('pairingFailed', { reason }));
      setStep('error');
      es.close();
    });
    es.addEventListener('error', () => {
      // o EventSource também emite 'error' ao fechar normalmente; só trata se ainda em 'qr'
      setError((prev) => prev ?? t('serverConnectionLost'));
      if (step === 'qr') setStep('error');
      es.close();
    });

    return () => es.close();
  }, [step, accountId, t]);

  async function submitName(formData: FormData) {
    setError(null);
    const r = await createAccountAction(formData);
    if (r.error || !r.accountId) {
      setError(r.error ?? tActions('genericFailure'));
      return;
    }
    setAccountId(r.accountId);
    setStep('qr');
  }

  if (step === 'name') {
    return (
      <form action={submitName}>
        <label htmlFor="label">{t('newAccountName')}</label>
        <input
          id="label"
          name="label"
          placeholder={t('newAccountPlaceholder')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        {error && <div className="error">{error}</div>}
        <button className="primary mt-16" type="submit" disabled={!label.trim()}>
          {t('continue')}
        </button>
      </form>
    );
  }

  if (step === 'qr') {
    return (
      <div style={{ textAlign: 'center' }}>
        <p className="muted">{t('qrInstructions')}</p>
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt="QR code" style={{ margin: '16px auto', display: 'block' }} />
        ) : (
          <p>{t('generatingQr')}</p>
        )}
        <p className="muted" style={{ fontSize: 12 }}>
          {t('qrAttempt', { attempt: qrAttempt })}
        </p>
      </div>
    );
  }

  if (step === 'connected') {
    return (
      <div>
        <p className="ok">{t('connectedAs', { phone: phone ?? '' })}</p>
        <p className="muted">{t('warmupNotice', { days: warmupDays })}</p>
        <button className="primary" onClick={() => router.push('/accounts')}>
          {t('goToAccounts')}
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="error">{error}</p>
      <button onClick={() => router.push('/accounts')}>{t('back')}</button>
    </div>
  );
}

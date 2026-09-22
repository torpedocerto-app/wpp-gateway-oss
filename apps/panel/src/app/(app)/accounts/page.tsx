import Link from 'next/link';
import { getTranslations, getFormatter } from 'next-intl/server';
import { listAccounts } from '@/lib/accounts';
import { AccountActions } from './account-actions';

export const dynamic = 'force-dynamic';

type T = (key: string, values?: Record<string, string | number>) => string;

function statusDot(status: string, isEnabled: boolean, t: T): { cls: string; label: string } {
  if (status === 'BANNED') return { cls: 'red', label: t('statusBanned') };
  if (!isEnabled) return { cls: 'gray', label: t('statusPaused') };
  if (status === 'CONNECTED') return { cls: 'green', label: t('statusConnected') };
  if (status === 'RECONNECTING') return { cls: 'yellow', label: t('statusReconnecting') };
  if (status === 'QR_PENDING') return { cls: 'yellow', label: t('statusQrPending') };
  return { cls: 'gray', label: t('statusDisconnected') };
}

function ago(d: Date | null, t: T): string {
  if (!d) return '—';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return t('agoSeconds', { s });
  if (s < 3600) return t('agoMinutes', { m: Math.round(s / 60) });
  return t('agoHours', { h: Math.round(s / 3600) });
}

export default async function AccountsPage() {
  const accounts = await listAccounts();
  const t = await getTranslations('accounts');
  const format = await getFormatter();

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{t('title')}</h1>
          <p className="subtitle">{t('poolCount', { n: accounts.length })}</p>
        </div>
        <Link href="/accounts/new" className="btn primary">
          + {t('add')}
        </Link>
      </div>

      {accounts.length === 0 ? (
        <div className="card">
          <p>{t('emptyTitle')}</p>
          <p className="muted">{t('emptyHint')}</p>
          <Link href="/accounts/new" className="btn primary">
            {t('addFirst')}
          </Link>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>{t('colStatus')}</th>
                <th>{t('colAccount')}</th>
                <th>{t('colNumber')}</th>
                <th>{t('colToday')}</th>
                <th>{t('colHour')}</th>
                <th>{t('colDelivery')}</th>
                <th>{t('colActivity')}</th>
                <th>{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const s = statusDot(a.status, a.isEnabled, t);
                return (
                  <tr key={a.id}>
                    <td>
                      <span className="badge">
                        <span className={`dot ${s.cls}`} /> {s.label}
                      </span>
                    </td>
                    <td>
                      <Link href={`/accounts/${a.id}`}>
                        {a.label}
                        {a.inWarmup ? <span className="muted"> ({t('warmup')})</span> : null}
                      </Link>
                    </td>
                    <td>{a.phoneNumber ? `+${a.phoneNumber}` : '—'}</td>
                    <td>
                      {a.sentToday}/{a.dailyLimit}
                    </td>
                    <td>
                      {a.sentThisHour}/{a.hourlyLimit}
                    </td>
                    <td>
                      {a.deliveryRate === null ? '—' : format.number(a.deliveryRate, 'percent')}
                    </td>
                    <td className="muted">{ago(a.lastSeenAt, t)}</td>
                    <td>
                      <AccountActions
                        id={a.id}
                        isEnabled={a.isEnabled}
                        status={a.status}
                        label={a.label}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

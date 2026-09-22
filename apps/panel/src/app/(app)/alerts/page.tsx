import Link from 'next/link';
import { getTranslations, getFormatter } from 'next-intl/server';
import { listAlerts } from '@/lib/alerts';
import { severityLabel } from '@/i18n/labels';

export const dynamic = 'force-dynamic';

function sevColor(s: string): string {
  if (s === 'CRITICAL') return 'red';
  if (s === 'HIGH') return 'yellow';
  if (s === 'MEDIUM') return 'yellow';
  return 'gray';
}

export default async function AlertsPage() {
  const alerts = await listAlerts();
  const t = await getTranslations('alerts');
  const tRoot = await getTranslations();
  const format = await getFormatter();

  return (
    <>
      <h1>{t('title')}</h1>
      <p className="subtitle">{t('subtitle')}</p>

      <div className="card">
        {alerts.length === 0 ? (
          <p className="muted">{t('noAlertsGoodSign')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('colWhen')}</th>
                <th>{t('colSeverity')}</th>
                <th>{t('colType')}</th>
                <th>{t('colAccount')}</th>
                <th>{t('colDetail')}</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td className="muted">{format.dateTime(a.createdAt, 'short')}</td>
                  <td>
                    <span className="badge">
                      <span className={`dot ${sevColor(a.severity)}`} /> {severityLabel(tRoot, a.severity)}
                    </span>
                  </td>
                  <td>{a.type}</td>
                  <td>
                    {a.accountId ? (
                      <Link href={`/accounts/${a.accountId}`}>{a.accountLabel ?? a.accountId}</Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ maxWidth: 400 }}>
                    <strong>{a.title}</strong>
                    {a.body && (
                      <div className="muted" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                        {a.body.length > 200 ? a.body.slice(0, 200) + '…' : a.body}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

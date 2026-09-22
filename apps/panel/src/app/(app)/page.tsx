import Link from 'next/link';
import { getTranslations, getFormatter } from 'next-intl/server';
import { dashboardStats, failureBreakdown, perAccountVolume, recentInbound } from '@/lib/stats';
import { sendErrorLabel } from '@/i18n/labels';

export const dynamic = 'force-dynamic';

function poolColor(active: number): string {
  if (active >= 4) return 'green';
  if (active >= 2) return 'yellow';
  return 'red';
}

export default async function DashboardPage() {
  const [stats, failures, volume, inbound] = await Promise.all([
    dashboardStats(),
    failureBreakdown(),
    perAccountVolume(),
    recentInbound(),
  ]);
  const t = await getTranslations('dashboard');
  const tRoot = await getTranslations();
  const format = await getFormatter();

  return (
    <>
      <h1>{t('title')}</h1>
      <p className="subtitle">{t('subtitle')}</p>

      <div className="stat-grid">
        <Link href="/accounts" className="stat" style={{ textDecoration: 'none' }}>
          <div className="label">{t('pool')}</div>
          <div className="value">
            <span className={`dot ${poolColor(stats.poolActive)}`} />{' '}
            {stats.poolActive} / {stats.poolTotal}
          </div>
        </Link>
        <Link href="/messages?status=sent" className="stat" style={{ textDecoration: 'none' }}>
          <div className="label">{t('sentToday')}</div>
          <div className="value">{stats.sentToday}</div>
        </Link>
        <div className="stat">
          <div className="label">{t('deliveryRate')}</div>
          <div className="value">
            {stats.deliveryRate === null ? '—' : format.number(stats.deliveryRate, 'percent')}
          </div>
        </div>
        <Link href="/messages?status=queued" className="stat" style={{ textDecoration: 'none' }}>
          <div className="label">{t('queue')}</div>
          <div className="value">{stats.queueDepth}</div>
        </Link>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('volumeByAccount')}</h3>
        {volume.length === 0 ? (
          <p className="muted">{t('noAccounts')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('colAccount')}</th>
                <th>{t('colSent')}</th>
                <th>{t('colDailyLimitPct')}</th>
              </tr>
            </thead>
            <tbody>
              {volume.map((v) => (
                <tr key={v.label}>
                  <td>{v.label}</td>
                  <td>{v.sent}</td>
                  <td>
                    <div
                      style={{
                        background: 'var(--surface-2)',
                        borderRadius: 4,
                        overflow: 'hidden',
                        height: 8,
                        width: 160,
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, v.pct * 100)}%`,
                          height: '100%',
                          background: v.pct > 0.85 ? 'var(--red)' : 'var(--accent)',
                        }}
                      />
                    </div>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {v.sent}/{v.dailyLimit}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('failuresByReason')}</h3>
        {failures.length === 0 ? (
          <p className="muted">{t('noFailuresToday')}</p>
        ) : (
          <table>
            <tbody>
              {failures.map((f) => (
                <tr key={f.code}>
                  <td>
                    <Link href={`/messages?status=failed&error=${f.code}`}>
                      {sendErrorLabel(tRoot, f.code)}
                    </Link>
                  </td>
                  <td style={{ textAlign: 'right' }}>{f.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('recentInbound')}</h3>
        {inbound.length === 0 ? (
          <p className="muted">{t('noInbound')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('colFrom')}</th>
                <th>{t('colMessage')}</th>
                <th>{t('colWhen')}</th>
              </tr>
            </thead>
            <tbody>
              {inbound.map((m) => (
                <tr key={m.id}>
                  <td>{m.fromNumber}</td>
                  <td>{m.content.length > 60 ? m.content.slice(0, 60) + '…' : m.content}</td>
                  <td className="muted">{format.dateTime(m.createdAt, 'short')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

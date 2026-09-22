import Link from 'next/link';
import { getTranslations, getFormatter } from 'next-intl/server';
import { workerApi } from '@/lib/worker-client';
import { QueueActions } from './queue-actions';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const t = await getTranslations('queue');
  const format = await getFormatter();
  let status: Awaited<ReturnType<typeof workerApi.queueStatus>> | null = null;
  let jobs: Awaited<ReturnType<typeof workerApi.queueJobs>>['jobs'] = [];
  let error: string | null = null;

  try {
    status = await workerApi.queueStatus();
    const waiting = await workerApi.queueJobs('waiting', 30);
    const delayed = await workerApi.queueJobs('delayed', 30);
    jobs = [...waiting.jobs, ...delayed.jobs];
  } catch (e) {
    error = e instanceof Error ? e.message : t('queryFailed');
  }

  return (
    <>
      <h1>{t('title')}</h1>
      <p className="subtitle">{t('subtitle')}</p>

      {error ? (
        <div className="card">
          <p className="error">{error}</p>
          <p className="muted">{t('workerRequired')}</p>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">{t('waiting')}</div>
              <div className="value">{status!.outbound.waiting ?? 0}</div>
            </div>
            <div className="stat">
              <div className="label">{t('active')}</div>
              <div className="value">{status!.outbound.active ?? 0}</div>
            </div>
            <div className="stat">
              <div className="label">{t('delayed')}</div>
              <div className="value">{status!.outbound.delayed ?? 0}</div>
            </div>
            <div className="stat">
              <div className="label">{t('failed')}</div>
              <div className="value">{status!.outbound.failed ?? 0}</div>
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                {t('outboundQueueLabel')} <strong>{status!.outboundPaused ? t('paused') : t('active')}</strong>
                {(status!.outbound.completed ?? 0) > 0 && (
                  <span className="muted">
                    {t('completedRetained', { n: status!.outbound.completed! })}
                  </span>
                )}
              </span>
              <QueueActions
                paused={status!.outboundPaused}
                failedCount={status!.outbound.failed ?? 0}
              />
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t('webhook')}</h3>
            <p className="muted">
              {t('waiting').toLowerCase()} {status!.webhook.waiting ?? 0} · {t('delayed').toLowerCase()}{' '}
              {status!.webhook.delayed ?? 0} · {t('failed').toLowerCase()} {status!.webhook.failed ?? 0}
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t('nextJobs')}</h3>
            {jobs.length === 0 ? (
              <p className="muted">{t('empty')}</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t('colMessage')}</th>
                    <th>{t('colTo')}</th>
                    <th>{t('colPriority')}</th>
                    <th>{t('colAttempts')}</th>
                    <th>{t('colWhen')}</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td>
                        {j.data.messageId ? (
                          <Link href={`/messages/${j.data.messageId}`}>
                            {j.data.messageId.slice(0, 8)}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{j.data.to ?? '—'}</td>
                      <td>{j.priority ?? 5}</td>
                      <td>
                        {j.data.triedAccountIds.length > 0
                          ? t('colTriedAccounts', { n: j.data.triedAccountIds.length })
                          : '—'}
                      </td>
                      <td className="muted">
                        {j.delayUntil
                          ? t('delayedUntil', { time: format.dateTime(new Date(j.delayUntil), 'time') })
                          : format.dateTime(new Date(j.addedAt), 'time')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}

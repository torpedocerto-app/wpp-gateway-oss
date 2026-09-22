import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations, getFormatter } from 'next-intl/server';
import { getMessage } from '@/lib/messages';
import { sendErrorLabel, messageStatusLabel, messageDirectionLabel } from '@/i18n/labels';

export const dynamic = 'force-dynamic';

type Translator = Awaited<ReturnType<typeof getTranslations<'messages'>>>;
type Formatter = Awaited<ReturnType<typeof getFormatter>>;

function line(when: Date | null, label: string, format: Formatter): string | null {
  if (!when) return null;
  return `${format.dateTime(when, 'time')}  ${label}`;
}

export default async function MessageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getMessage(id);
  if (!data) notFound();
  const { message: m, attempts } = data;
  const t: Translator = await getTranslations('messages');
  const tDash = await getTranslations('dashboard');
  const tRoot = await getTranslations();
  const format = await getFormatter();

  const timeline: string[] = [
    line(
      m.createdAt,
      m.apiToken ? `${t('timeline.createdViaToken')} "${m.apiToken.name}"` : t('timeline.created'),
      format,
    ),
    line(m.queuedAt, t('timeline.queued'), format),
    ...attempts.flatMap((a) => {
      const head = t('timeline.attempt', { n: a.attemptNumber, account: `"${a.accountLabel}"` });
      const res =
        a.result === 'SUCCESS'
          ? `   ✅ ${a.result} (${a.durationMs}ms)`
          : `   ❌ ${sendErrorLabel(tRoot, a.errorCode)} (${a.durationMs}ms)`;
      return [line(a.createdAt, head, format), res].filter(Boolean) as string[];
    }),
    line(m.sentAt, t('timeline.sent'), format),
    line(m.deliveredAt, t('timeline.delivered'), format),
    line(m.readAt, t('timeline.read'), format),
    line(m.failedAt, t('timeline.failed', { code: sendErrorLabel(tRoot, m.errorCode) }), format),
  ].filter(Boolean) as string[];

  return (
    <>
      <p>
        <Link href="/messages">{t('detailBack')}</Link>
      </p>
      <h1>{t('detailTitle', { id: m.id.slice(0, 8) })}</h1>
      <p className="subtitle">
        {t('colStatus')}: <strong>{messageStatusLabel(tRoot, m.status)}</strong> ·{' '}
        {messageDirectionLabel(tRoot, m.direction)}
      </p>

      <div className="card">
        <p>
          <strong>{m.direction === 'INBOUND' ? tDash('colFrom') : t('colTo')}:</strong>{' '}
          {m.direction === 'INBOUND' ? m.fromNumber : m.toNumber}
        </p>
        <p>
          <strong>{t('project')}</strong> {m.project?.name ?? t('notAssigned')}
        </p>
        {m.externalId && (
          <p>
            <strong>{t('externalId')}</strong> {m.externalId}
          </p>
        )}
        <p style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 6 }}>{m.content}</p>
        {m.errorCode && (
          <p className="error">
            {m.errorCode}: {m.errorMessage}
          </p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('timelineTitle')}</h3>
        <ul className="timeline">
          {timeline.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    </>
  );
}

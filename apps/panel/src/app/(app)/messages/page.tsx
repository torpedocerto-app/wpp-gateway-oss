import Link from 'next/link';
import { getTranslations, getFormatter } from 'next-intl/server';
import { listMessages } from '@/lib/messages';
import { messageStatusLabel } from '@/i18n/labels';

export const dynamic = 'force-dynamic';

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { rows, nextCursor } = await listMessages({
    status: sp.status,
    direction: sp.direction,
    to: sp.to,
    error: sp.error,
    cursor: sp.cursor,
  });
  const t = await getTranslations('messages');
  const tRoot = await getTranslations();
  const format = await getFormatter();

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };

  return (
    <>
      <h1>{t('title')}</h1>
      <p className="subtitle">
        {sp.status ? t('filterByStatus', { status: sp.status }) : t('filterAllStatus')}
        {sp.error ? t('filterByError', { error: sp.error }) : ''}
        {sp.to ? t('filterByTo', { to: sp.to }) : ''}
      </p>

      <div className="card">
        <form className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <select name="status" defaultValue={sp.status ?? ''}>
            <option value="">{t('statusAllOption')}</option>
            {['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'canceled'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select name="direction" defaultValue={sp.direction ?? ''}>
            <option value="">{t('directionAllOption')}</option>
            <option value="outbound">{t('directionOutbound')}</option>
            <option value="inbound">{t('directionInbound')}</option>
          </select>
          <input name="to" placeholder={t('toPlaceholder')} defaultValue={sp.to ?? ''} style={{ width: 160 }} />
          <button type="submit">{t('filter')}</button>
          <Link href="/messages" className="btn">
            {t('clear')}
          </Link>
        </form>

        {rows.length === 0 ? (
          <p className="muted">{t('noMessages')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('colDirection')}</th>
                <th>{t('colStatus')}</th>
                <th>{t('colTo')}</th>
                <th>{t('colProject')}</th>
                <th>{t('externalId')}</th>
                <th>{t('colError')}</th>
                <th>{t('colWhen')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.direction === 'INBOUND' ? '↓' : '↑'}</td>
                  <td>
                    <Link href={`/messages/${m.id}`}>{messageStatusLabel(tRoot, m.status)}</Link>
                  </td>
                  <td>{m.direction === 'INBOUND' ? m.fromNumber : m.toNumber}</td>
                  <td>{m.project?.name ?? '—'}</td>
                  <td className="muted">{m.externalId ?? '—'}</td>
                  <td className="muted">{m.errorCode ?? '—'}</td>
                  <td className="muted">{format.dateTime(m.createdAt, 'short')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {nextCursor && (
          <p style={{ marginTop: 12 }}>
            <Link href={qs({ cursor: nextCursor })} className="btn">
              {t('nextPage')}
            </Link>
          </p>
        )}
      </div>
    </>
  );
}

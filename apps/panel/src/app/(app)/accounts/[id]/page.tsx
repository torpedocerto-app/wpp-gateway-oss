import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations, getFormatter } from 'next-intl/server';
import { getAccount } from '@/lib/accounts';
import { messageStatusLabel, accountEventLabel } from '@/i18n/labels';

export const dynamic = 'force-dynamic';

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getAccount(id);
  if (!data) notFound();
  const { account, events, recentMessages } = data;
  const t = await getTranslations('accounts');
  const tMsg = await getTranslations('messages');
  const tRoot = await getTranslations();
  const format = await getFormatter();

  const warmupLeft =
    account.warmupUntil && account.warmupUntil.getTime() > Date.now()
      ? Math.ceil((account.warmupUntil.getTime() - Date.now()) / 86_400_000)
      : 0;

  return (
    <>
      <p>
        <Link href="/accounts">{t('detailBack')}</Link>
      </p>
      <h1>{account.label}</h1>
      <p className="subtitle">
        {account.phoneNumber ? `+${account.phoneNumber}` : t('notPaired')} · {account.status}
        {warmupLeft > 0 ? t('warmupDaysLeft', { d: warmupLeft }) : ''}
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('limits')}</h3>
        <p>
          {t('daily')}: {account.dailyLimit} · {t('hourly')}: {account.hourlyLimit} · {t('priority')}:{' '}
          {account.priority}
        </p>
        {account.lastError && <p className="muted">{t('lastError', { error: account.lastError })}</p>}
        {account.bannedAt && (
          <p className="error">{t('bannedAt', { date: format.dateTime(account.bannedAt, 'short') })}</p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('timeline')}</h3>
        {events.length === 0 ? (
          <p className="muted">{t('noEvents')}</p>
        ) : (
          <ul className="timeline">
            {events.map((e) => (
              <li key={e.id}>
                {format.dateTime(e.createdAt, 'short')} — <strong>{accountEventLabel(tRoot, e.type)}</strong>{' '}
                <span className="muted">{JSON.stringify(e.detail)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('lastMessagesOfAccount')}</h3>
        {recentMessages.length === 0 ? (
          <p className="muted">{t('noMessages')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('colTo')}</th>
                <th>{tMsg('colStatus')}</th>
                <th>{tMsg('colWhen')}</th>
              </tr>
            </thead>
            <tbody>
              {recentMessages.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/messages/${m.id}`}>{m.toNumber}</Link>
                  </td>
                  <td>{messageStatusLabel(tRoot, m.status)}</td>
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

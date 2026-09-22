import Link from 'next/link';
import { getTranslations, getFormatter } from 'next-intl/server';
import { listConversations, accountsForNewChat } from '@/lib/chat';
import { NewChatButton } from './new-chat-button';

export const dynamic = 'force-dynamic';

function ago(d: Date, format: Awaited<ReturnType<typeof getFormatter>>): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return format.dateTime(d, 'date');
}

export default async function ChatListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [conversations, accounts] = await Promise.all([
    listConversations(q),
    accountsForNewChat(),
  ]);
  const t = await getTranslations('chat');
  const format = await getFormatter();

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{t('title')}</h1>
          <p className="subtitle">{t('subtitleConversations')}</p>
        </div>
        <NewChatButton accounts={accounts} />
      </div>

      <div className="card">
        <form className="row" style={{ marginBottom: 12 }}>
          <input name="q" placeholder={t('searchPlaceholder')} defaultValue={q ?? ''} />
          <button type="submit">{t('search')}</button>
          {q && (
            <Link href="/chat" className="btn">
              {t('clear')}
            </Link>
          )}
        </form>

        {conversations.length === 0 ? (
          <p className="muted">{q ? t('noResultsSearch') : t('noConversations')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('colContact')}</th>
                <th>{t('colAccount')}</th>
                <th>{t('colLastMessage')}</th>
                <th>{t('colWhen')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {conversations.map((c) => (
                <tr key={`${c.contact}-${c.accountId}`}>
                  <td>
                    <Link
                      href={`/chat/${encodeURIComponent(c.contact)}?account=${c.accountId}`}
                      style={{ fontWeight: c.unread > 0 ? 700 : 400 }}
                    >
                      {c.contact}
                    </Link>
                    {c.unread > 0 && (
                      <span className="badge" style={{ marginLeft: 8, background: 'var(--accent)' }}>
                        {c.unread}
                      </span>
                    )}
                  </td>
                  <td className="muted">{c.accountLabel}</td>
                  <td>
                    {c.lastDirection === 'OUTBOUND' && <span className="muted">{t('you')}</span>}
                    {c.lastMessage.length > 50 ? c.lastMessage.slice(0, 50) + '…' : c.lastMessage}
                  </td>
                  <td className="muted">{ago(c.lastAt, format)}</td>
                  <td>
                    <Link
                      href={`/chat/${encodeURIComponent(c.contact)}?account=${c.accountId}`}
                      className="btn"
                    >
                      {t('open')}
                    </Link>
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

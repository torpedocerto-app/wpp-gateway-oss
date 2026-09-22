import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getConversation, markConversationRead } from '@/lib/chat';
import { ChatThread } from './chat-thread';

export const dynamic = 'force-dynamic';

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ contact: string }>;
  searchParams: Promise<{ account?: string; new?: string }>;
}) {
  const { contact: contactRaw } = await params;
  const { account: accountId, new: isNew } = await searchParams;
  const contact = decodeURIComponent(contactRaw);

  if (!accountId) notFound();

  const { messages, account } = await getConversation(contact, accountId);
  if (!account) notFound();

  // marca como lida ao abrir (a menos que seja conversa nova sem histórico)
  if (!isNew) await markConversationRead(contact, accountId);

  const t = await getTranslations('chat');

  return (
    <>
      <p>
        <Link href="/chat">{t('backToList')}</Link>
      </p>
      <h1>{contact}</h1>
      <p className="subtitle">
        {t('viaAccount', { label: account.label })}
        {account.phoneNumber ? ` (+${account.phoneNumber})` : ''} ·{' '}
        {account.status === 'CONNECTED' && account.isEnabled ? t('accountActive') : t('accountUnavailable')}
      </p>

      <ChatThread
        contact={contact}
        accountId={accountId}
        accountReady={account.status === 'CONNECTED' && account.isEnabled}
        initialMessages={messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          content: m.content,
          status: m.status,
          createdAt: m.createdAt.toISOString(),
          errorCode: m.errorCode,
        }))}
      />
    </>
  );
}

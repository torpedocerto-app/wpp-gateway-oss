import { prisma } from '@wpp/database';

/**
 * Conversas do chat (Fase 6c). Derivadas de `messages` — uma conversa é o par
 * (número do contato, conta que atende). Sem tabela dedicada por enquanto.
 *
 * "Não lida" = mensagem INBOUND com `read_at = null`. O painel marca `read_at`
 * ao abrir a conversa.
 */

export interface ConversationSummary {
  contact: string; // +57...
  accountId: string;
  accountLabel: string;
  lastMessage: string;
  lastAt: Date;
  lastDirection: 'INBOUND' | 'OUTBOUND';
  unread: number;
}

/** Lista de conversas, ordenada pela última mensagem. Filtro opcional por texto/contato. */
export async function listConversations(search?: string): Promise<ConversationSummary[]> {
  // Puxa as últimas ~500 mensagens que têm accountId + um número de contato,
  // e agrupa em memória (volume do MVP é baixo).
  const rows = await prisma.message.findMany({
    where: {
      accountId: { not: null },
      OR: [{ direction: 'INBOUND' }, { direction: 'OUTBOUND' }],
      ...(search
        ? {
            OR: [
              { content: { contains: search, mode: 'insensitive' } },
              { fromNumber: { contains: search.replace(/\D/g, '') } },
              { toNumber: { contains: search.replace(/\D/g, '') } },
            ],
          }
        : {}),
    },
    select: {
      direction: true,
      accountId: true,
      toNumber: true,
      fromNumber: true,
      content: true,
      createdAt: true,
      readAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 800,
  });

  const accounts = await prisma.account.findMany({ select: { id: true, label: true } });
  const label = new Map(accounts.map((a) => [a.id, a.label]));

  const map = new Map<string, ConversationSummary>();
  for (const m of rows) {
    const contact = m.direction === 'INBOUND' ? m.fromNumber : m.toNumber;
    if (!contact || !m.accountId) continue;
    const key = `${contact}::${m.accountId}`;

    let conv = map.get(key);
    if (!conv) {
      conv = {
        contact,
        accountId: m.accountId,
        accountLabel: label.get(m.accountId) ?? m.accountId,
        lastMessage: m.content,
        lastAt: m.createdAt,
        lastDirection: m.direction,
        unread: 0,
      };
      map.set(key, conv);
    }
    if (m.direction === 'INBOUND' && m.readAt === null) conv.unread++;
  }

  return [...map.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

/** Todas as formas em que o número pode estar gravado (com/sem +). */
function numberVariants(contact: string): string[] {
  const digits = contact.replace(/\D/g, '');
  return [`+${digits}`, digits];
}

/** Histórico completo de uma conversa (contato + conta). */
export async function getConversation(contact: string, accountId: string) {
  const variants = numberVariants(contact);
  const messages = await prisma.message.findMany({
    where: {
      accountId,
      OR: [
        { direction: 'INBOUND', fromNumber: { in: variants } },
        { direction: 'OUTBOUND', toNumber: { in: variants } },
      ],
    },
    select: {
      id: true,
      direction: true,
      status: true,
      content: true,
      createdAt: true,
      errorCode: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, label: true, phoneNumber: true, status: true, isEnabled: true },
  });

  return { messages, account };
}

/** Marca todas as mensagens INBOUND não lidas de uma conversa como lidas. */
export async function markConversationRead(contact: string, accountId: string): Promise<void> {
  await prisma.message.updateMany({
    where: {
      accountId,
      direction: 'INBOUND',
      fromNumber: { in: numberVariants(contact) },
      readAt: null,
    },
    data: { readAt: new Date() },
  });
}

/** Contas elegíveis para iniciar uma nova conversa (conectadas e habilitadas). */
export async function accountsForNewChat() {
  return prisma.account.findMany({
    where: { status: 'CONNECTED', isEnabled: true },
    select: { id: true, label: true, phoneNumber: true },
    orderBy: { label: 'asc' },
  });
}

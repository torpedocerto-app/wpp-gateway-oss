import { prisma } from './index.js';

/**
 * Opt-out real (tabela `suppressed_contacts`, doc 06 §5 — "Fase 8" concluída).
 *
 * Tenant-wide por número de telefone: a supressão vale para qualquer conta do
 * pool, não só a que originou o pedido — quem pede para parar não sabe (nem
 * deve precisar saber) qual número específico está mandando.
 *
 * Sem cache — o ponto de envio precisa ver a supressão assim que ela existe.
 */

/** `true` se o número está suprimido (não deve receber novas mensagens). */
export async function isSuppressed(phoneNumber: string): Promise<boolean> {
  const row = await prisma.suppressedContact.findUnique({
    where: { phoneNumber },
    select: { id: true },
  });
  return row !== null;
}

/** Suprime um número. Idempotente — chamar de novo não duplica nem falha. */
export async function suppressContact(phoneNumber: string, reason = 'opt_out_keyword'): Promise<void> {
  await prisma.suppressedContact.upsert({
    where: { phoneNumber },
    update: {},
    create: { phoneNumber, reason },
  });
}

/** Remove a supressão de um número (reativação manual, uso futuro no painel). */
export async function unsuppressContact(phoneNumber: string): Promise<void> {
  await prisma.suppressedContact.deleteMany({ where: { phoneNumber } });
}

export interface SuppressedContactRow {
  id: string;
  phoneNumber: string;
  reason: string;
  createdAt: Date;
}

/** Lista supressões, mais recente primeiro (uso futuro no painel). */
export async function listSuppressed(limit = 100): Promise<SuppressedContactRow[]> {
  return prisma.suppressedContact.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

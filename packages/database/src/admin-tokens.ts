import { prisma } from './index.js';
import type { AdminTokenPurpose } from '@prisma/client';

/**
 * Persistência dos tokens de uso único do painel (tabela `admin_tokens`).
 * A lógica pura (gerar/hashear/TTL) vive em `@wpp/email`. Aqui só grava o
 * sha256 e valida contra expiração / uso.
 */

export type { AdminTokenPurpose };

export interface UsableAdminToken {
  id: string;
  userId: string;
  purpose: AdminTokenPurpose;
  user: { id: string; email: string; disabledAt: Date | null };
}

/**
 * Cria um token. Para `RESET`, apaga antes os RESET não usados do mesmo
 * usuário — só o link mais recente vale.
 */
export async function createAdminToken(input: {
  userId: string;
  purpose: AdminTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  if (input.purpose === 'RESET') {
    await prisma.adminToken.deleteMany({
      where: { userId: input.userId, purpose: 'RESET', usedAt: null },
    });
  }
  await prisma.adminToken.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    },
  });
}

/**
 * Busca um token utilizável pelo hash: purpose correto, não usado, não expirado.
 * Retorna `null` em qualquer falha (não distingue os casos — é para auth).
 */
export async function findUsableAdminToken(
  tokenHash: string,
  purpose: AdminTokenPurpose,
): Promise<UsableAdminToken | null> {
  const row = await prisma.adminToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      purpose: true,
      usedAt: true,
      expiresAt: true,
      user: { select: { id: true, email: true, disabledAt: true } },
    },
  });
  if (!row) return null;
  if (row.purpose !== purpose) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return { id: row.id, userId: row.userId, purpose: row.purpose, user: row.user };
}

/** Marca um token como usado. */
export async function consumeAdminToken(id: string): Promise<void> {
  await prisma.adminToken.update({ where: { id }, data: { usedAt: new Date() } });
}

/** Instante de criação do RESET mais recente de um usuário (throttle de 60s). */
export async function lastResetTokenAt(userId: string): Promise<Date | null> {
  const row = await prisma.adminToken.findFirst({
    where: { userId, purpose: 'RESET' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

/** Invalida todos os tokens não usados de um usuário (após reset / troca de senha). */
export async function invalidateUserTokens(userId: string): Promise<void> {
  await prisma.adminToken.deleteMany({ where: { userId, usedAt: null } });
}

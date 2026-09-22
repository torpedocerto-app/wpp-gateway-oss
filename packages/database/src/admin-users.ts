import { prisma } from './index.js';

/**
 * Usuários do painel (tabela `admin_users`). Multi-usuário por tenant.
 *
 * Sem cache — autenticação precisa ler estado fresco (usuário pode ter sido
 * desativado). O sentinel `'SETUP_PENDING'` em `passwordHash` marca um usuário
 * criado (seed / convite / admin-create.sh) que ainda não definiu senha.
 */

export const SETUP_PENDING = 'SETUP_PENDING';

/** `true` se o usuário ainda não definiu senha (fluxo /login/setup pendente). */
export function needsSetup(passwordHash: string): boolean {
  return passwordHash === SETUP_PENDING;
}

export interface AdminForAuth {
  id: string;
  email: string;
  passwordHash: string;
  totpSecret: string | null;
  totpEnabled: boolean;
  disabledAt: Date | null;
  locale: string;
}

/** Busca por email (case já normalizado pelo caller). Inclui desativados. */
export function findAdminByEmail(email: string): Promise<AdminForAuth | null> {
  return prisma.adminUser.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      totpSecret: true,
      totpEnabled: true,
      disabledAt: true,
      locale: true,
    },
  });
}

export interface AdminIdentity {
  id: string;
  email: string;
  name: string | null;
  totpEnabled: boolean;
  disabledAt: Date | null;
  locale: string;
}

/** Busca por id — usado pelo requireSession endurecido e pela tela de Usuários. */
export function getAdminById(id: string): Promise<AdminIdentity | null> {
  return prisma.adminUser.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, totpEnabled: true, disabledAt: true, locale: true },
  });
}

export interface AdminRow {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  totpEnabled: boolean;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  invitedById: string | null;
  locale: string;
}

/** Lista todos os usuários, mais antigo primeiro (para a tela de Usuários). */
export function listAdmins(): Promise<AdminRow[]> {
  return prisma.adminUser.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      totpEnabled: true,
      disabledAt: true,
      lastLoginAt: true,
      createdAt: true,
      invitedById: true,
      locale: true,
    },
  });
}

/** Quantos usuários ativos (não desativados) existem. */
export function countActiveAdmins(): Promise<number> {
  return prisma.adminUser.count({ where: { disabledAt: null } });
}

/**
 * Cria um usuário convidado, sem senha (`SETUP_PENDING`). Lança se o email já
 * existe (o caller mapeia para "e-mail já cadastrado").
 */
export function createInvitedAdmin(input: {
  email: string;
  name?: string | null;
  invitedById: string;
  /** Idioma inicial — herda o de quem convidou; o convidado troca depois. */
  locale?: string;
}): Promise<{ id: string; email: string }> {
  return prisma.adminUser.create({
    data: {
      email: input.email,
      name: input.name ?? null,
      invitedById: input.invitedById,
      passwordHash: SETUP_PENDING,
      locale: input.locale ?? 'pt',
    },
    select: { id: true, email: true },
  });
}

/** Cria o primeiro usuário de um tenant, sem senha. Usado por admin-create.sh. */
export function createBootstrapAdmin(email: string): Promise<{ id: string; email: string }> {
  return prisma.adminUser.create({
    data: { email, passwordHash: SETUP_PENDING },
    select: { id: true, email: true },
  });
}

/** Ativa/desativa um usuário. */
export async function setAdminDisabled(id: string, disabled: boolean): Promise<void> {
  await prisma.adminUser.update({
    where: { id },
    data: { disabledAt: disabled ? new Date() : null },
  });
}

/** Define o idioma preferido de um usuário ('pt' | 'es' | 'en'). */
export async function setAdminLocale(id: string, locale: string): Promise<void> {
  await prisma.adminUser.update({ where: { id }, data: { locale } });
}

/** Remove um usuário (cascateia os tokens dele). */
export async function deleteAdmin(id: string): Promise<void> {
  await prisma.adminUser.delete({ where: { id } });
}

/** Marca o último login. */
export async function touchAdminLogin(id: string): Promise<void> {
  await prisma.adminUser.update({ where: { id }, data: { lastLoginAt: new Date() } });
}

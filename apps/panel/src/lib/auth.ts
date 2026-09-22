import { redirect } from 'next/navigation';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import {
  prisma,
  SETUP_PENDING,
  needsSetup,
  findAdminByEmail,
  getAdminById,
  touchAdminLogin,
  type AdminForAuth,
} from '@wpp/database';
import { env } from './env';
import { getSession } from './session';

/**
 * Auth do painel (doc 08 §3): email + senha Argon2id + TOTP obrigatório.
 * Multi-usuário — várias linhas em `admin_users` por tenant.
 *
 * `passwordHash === 'SETUP_PENDING'` marca um usuário criado (seed / convite /
 * admin-create.sh) que ainda não passou pelo fluxo /login/setup.
 */

export { needsSetup, SETUP_PENDING };

/** Busca um usuário por email (normaliza para minúsculas). Inclui desativados. */
export function getUserByEmail(email: string): Promise<AdminForAuth | null> {
  return findAdminByEmail(email.trim().toLowerCase());
}

/** Erro de bootstrap com código estável para a página /login/setup traduzir. */
export class BootstrapError extends Error {
  constructor(public code: 'noPendingSetup' | 'multiplePendingSetup') {
    super(code);
    this.name = 'BootstrapError';
  }
}

/**
 * O único usuário `SETUP_PENDING` do tenant — usado pelo /login/setup de
 * primeiro acesso (sem token de convite). Erro se houver 0 ou mais de 1.
 */
export async function getBootstrapAdmin(): Promise<{ id: string; email: string }> {
  const pend = await prisma.adminUser.findMany({
    where: { passwordHash: SETUP_PENDING },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });
  if (pend.length === 0) throw new BootstrapError('noPendingSetup');
  if (pend.length > 1) throw new BootstrapError('multiplePendingSetup');
  return pend[0]!;
}

/** Verifica a senha de um usuário. */
export async function verifyPassword(userId: string, password: string): Promise<boolean> {
  const user = await prisma.adminUser.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user || user.passwordHash === SETUP_PENDING) return false;
  try {
    return await argon2.verify(user.passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * `argon2.verify` contra um hash fixo — usado no caminho de "usuário não existe"
 * para o tempo de resposta do login não vazar a existência do email.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=4$8J4ypGaOVsiqPMT/J06L7A$MlNaY/kxv2qoo6n1kIPcOapT8EJY48QM5cDJpAwtVXA';
export async function dummyVerify(password: string): Promise<void> {
  try {
    await argon2.verify(DUMMY_HASH, password);
  } catch {
    /* esperado — só queima tempo de CPU */
  }
}

/** Verifica um código TOTP de 6 dígitos. */
export async function verifyTotp(userId: string, token: string): Promise<boolean> {
  const user = await prisma.adminUser.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpEnabled: true },
  });
  if (!user?.totpEnabled || !user.totpSecret) return false;
  return authenticator.verify({ token: token.replace(/\s/g, ''), secret: user.totpSecret });
}

/** Define a senha (fluxo de setup e reset). */
export async function setPassword(userId: string, password: string): Promise<void> {
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB (doc 08 §3)
    timeCost: 2,
  });
  await prisma.adminUser.update({ where: { id: userId }, data: { passwordHash: hash } });
}

/** Gera e salva um segredo TOTP (ainda não habilitado até o 1º código válido). */
export async function provisionTotp(
  userId: string,
  email: string,
): Promise<{ secret: string; otpauth: string }> {
  const secret = authenticator.generateSecret();
  await prisma.adminUser.update({ where: { id: userId }, data: { totpSecret: secret } });
  const otpauth = authenticator.keyuri(email, env.PANEL_BRAND_NAME, secret);
  return { secret, otpauth };
}

/** Confirma o TOTP: valida o 1º código e marca como habilitado. */
export async function confirmTotp(userId: string, token: string): Promise<boolean> {
  const user = await prisma.adminUser.findUnique({
    where: { id: userId },
    select: { totpSecret: true },
  });
  if (!user?.totpSecret) return false;
  const ok = authenticator.verify({ token: token.replace(/\s/g, ''), secret: user.totpSecret });
  if (ok) {
    await prisma.adminUser.update({ where: { id: userId }, data: { totpEnabled: true } });
  }
  return ok;
}

/** Marca o último login. */
export async function touchLogin(userId: string): Promise<void> {
  await touchAdminLogin(userId);
}

export interface SessionUser {
  userId: string;
  email: string;
  name: string | null;
  locale: string;
}

/**
 * Guard para páginas e server actions protegidos. Além de exigir uma sessão
 * válida, recarrega o usuário: se foi removido ou desativado, manda para /login
 * (1 SELECT por PK indexada por request protegido).
 *
 * Não apaga o cookie aqui — `cookies().delete()` não pode rodar durante o render
 * de uma página (só em Server Action / Route Handler). O cookie obsoleto é
 * inofensivo: todo request protegido revalida o usuário e é barrado de novo; o
 * logout explícito (logoutAction) limpa o cookie.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect('/login');
  const user = await getAdminById(session.userId);
  if (!user || user.disabledAt) redirect('/login');
  return { userId: user.id, email: user.email, name: user.name, locale: user.locale };
}

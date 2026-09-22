import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from './index.js';
import { createBootstrapAdmin } from './admin-users.js';
import {
  createAdminToken,
  findUsableAdminToken,
  consumeAdminToken,
  lastResetTokenAt,
  invalidateUserTokens,
} from './admin-tokens.js';

const MARK = 'vitest-admintokens';
const email = (s: string) => `${MARK}+${s}@example.test`;
const hash = (s: string) => `${'0'.repeat(64 - s.length)}${s}`; // hash hex fake, 64 chars

let userId: string;

beforeEach(async () => {
  await prisma.adminUser.deleteMany({ where: { email: { contains: MARK } } });
  userId = (await createBootstrapAdmin(email('u'))).id;
});
afterEach(async () => {
  await prisma.adminUser.deleteMany({ where: { email: { contains: MARK } } });
});

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 1_000);

describe('admin-tokens', () => {
  it('cria, encontra, consome e depois não encontra', async () => {
    await createAdminToken({ userId, purpose: 'RESET', tokenHash: hash('a'), expiresAt: future() });
    const found = await findUsableAdminToken(hash('a'), 'RESET');
    expect(found?.userId).toBe(userId);
    expect(found?.user.email).toBe(email('u'));
    await consumeAdminToken(found!.id);
    expect(await findUsableAdminToken(hash('a'), 'RESET')).toBeNull();
  });

  it('token expirado não é utilizável', async () => {
    await createAdminToken({ userId, purpose: 'RESET', tokenHash: hash('b'), expiresAt: past() });
    expect(await findUsableAdminToken(hash('b'), 'RESET')).toBeNull();
  });

  it('purpose errado não casa', async () => {
    await createAdminToken({ userId, purpose: 'INVITE', tokenHash: hash('c'), expiresAt: future() });
    expect(await findUsableAdminToken(hash('c'), 'RESET')).toBeNull();
    expect(await findUsableAdminToken(hash('c'), 'INVITE')).not.toBeNull();
  });

  it('novo RESET invalida os RESET não usados anteriores', async () => {
    await createAdminToken({ userId, purpose: 'RESET', tokenHash: hash('d1'), expiresAt: future() });
    await createAdminToken({ userId, purpose: 'RESET', tokenHash: hash('d2'), expiresAt: future() });
    expect(await findUsableAdminToken(hash('d1'), 'RESET')).toBeNull();
    expect(await findUsableAdminToken(hash('d2'), 'RESET')).not.toBeNull();
  });

  it('INVITE não é apagado ao criar um RESET', async () => {
    await createAdminToken({ userId, purpose: 'INVITE', tokenHash: hash('e1'), expiresAt: future() });
    await createAdminToken({ userId, purpose: 'RESET', tokenHash: hash('e2'), expiresAt: future() });
    expect(await findUsableAdminToken(hash('e1'), 'INVITE')).not.toBeNull();
  });

  it('lastResetTokenAt retorna o mais recente; invalidateUserTokens limpa os não usados', async () => {
    expect(await lastResetTokenAt(userId)).toBeNull();
    await createAdminToken({ userId, purpose: 'RESET', tokenHash: hash('f'), expiresAt: future() });
    expect(await lastResetTokenAt(userId)).toBeInstanceOf(Date);
    await invalidateUserTokens(userId);
    expect(await findUsableAdminToken(hash('f'), 'RESET')).toBeNull();
  });
});

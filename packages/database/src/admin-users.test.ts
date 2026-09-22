import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from './index.js';
import {
  SETUP_PENDING,
  needsSetup,
  findAdminByEmail,
  getAdminById,
  listAdmins,
  countActiveAdmins,
  createInvitedAdmin,
  createBootstrapAdmin,
  setAdminDisabled,
  setAdminLocale,
  deleteAdmin,
  touchAdminLogin,
} from './admin-users.js';

const MARK = 'vitest-adminusers';
const email = (s: string) => `${MARK}+${s}@example.test`;

async function cleanup() {
  await prisma.adminUser.deleteMany({ where: { email: { contains: MARK } } });
}
beforeEach(cleanup);
afterEach(cleanup);

describe('admin-users', () => {
  it('needsSetup reconhece o sentinel', () => {
    expect(needsSetup(SETUP_PENDING)).toBe(true);
    expect(needsSetup('$argon2id$...')).toBe(false);
  });

  it('createBootstrapAdmin / createInvitedAdmin nascem SETUP_PENDING e registram quem convidou', async () => {
    const boot = await createBootstrapAdmin(email('boot'));
    await createInvitedAdmin({ email: email('inv'), invitedById: boot.id });
    const bootRow = await findAdminByEmail(email('boot'));
    const invRow = (await listAdmins()).find((r) => r.email === email('inv'));
    expect(bootRow?.passwordHash).toBe(SETUP_PENDING);
    expect(invRow?.passwordHash).toBe(SETUP_PENDING);
    expect(invRow?.invitedById).toBe(boot.id);
  });

  it('email duplicado lança', async () => {
    await createBootstrapAdmin(email('dup'));
    await expect(createBootstrapAdmin(email('dup'))).rejects.toThrow();
  });

  it('setAdminDisabled alterna disabledAt e countActiveAdmins exclui desativados', async () => {
    const a = await createBootstrapAdmin(email('a'));
    await createBootstrapAdmin(email('b'));
    const before = await countActiveAdmins();
    await setAdminDisabled(a.id, true);
    expect(await countActiveAdmins()).toBe(before - 1);
    expect((await getAdminById(a.id))?.disabledAt).toBeInstanceOf(Date);
    await setAdminDisabled(a.id, false);
    expect((await getAdminById(a.id))?.disabledAt).toBeNull();
  });

  it('listAdmins ordena por createdAt e inclui os criados', async () => {
    await createBootstrapAdmin(email('x'));
    await createBootstrapAdmin(email('y'));
    const rows = (await listAdmins()).filter((r) => r.email.includes(MARK));
    expect(rows.map((r) => r.email)).toEqual([email('x'), email('y')]);
  });

  it('novo usuário nasce com locale "pt"; setAdminLocale troca', async () => {
    const a = await createBootstrapAdmin(email('loc'));
    expect((await findAdminByEmail(email('loc')))?.locale).toBe('pt');
    await setAdminLocale(a.id, 'es');
    expect((await getAdminById(a.id))?.locale).toBe('es');
  });

  it('touchAdminLogin grava lastLoginAt; deleteAdmin remove', async () => {
    const a = await createBootstrapAdmin(email('del'));
    await touchAdminLogin(a.id);
    const rows = await listAdmins();
    expect(rows.find((r) => r.id === a.id)?.lastLoginAt).toBeInstanceOf(Date);
    await deleteAdmin(a.id);
    expect(await getAdminById(a.id)).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from './index.js';
import { isSuppressed, suppressContact, unsuppressContact, listSuppressed } from './suppressed-contacts.js';

const PHONE = '+5511999990000';

beforeEach(async () => {
  await prisma.suppressedContact.deleteMany({ where: { phoneNumber: PHONE } });
});
afterEach(async () => {
  await prisma.suppressedContact.deleteMany({ where: { phoneNumber: PHONE } });
});

describe('suppressed-contacts (opt-out real)', () => {
  it('isSuppressed → false quando não existe', async () => {
    expect(await isSuppressed(PHONE)).toBe(false);
  });

  it('suppressContact cria a supressão; isSuppressed passa a true', async () => {
    await suppressContact(PHONE);
    expect(await isSuppressed(PHONE)).toBe(true);
  });

  it('suppressContact é idempotente (upsert, não duplica nem falha)', async () => {
    await suppressContact(PHONE);
    await suppressContact(PHONE);
    const rows = await prisma.suppressedContact.findMany({ where: { phoneNumber: PHONE } });
    expect(rows).toHaveLength(1);
  });

  it('reason default é opt_out_keyword; aceita reason customizado', async () => {
    await suppressContact(PHONE);
    const row = await prisma.suppressedContact.findUniqueOrThrow({ where: { phoneNumber: PHONE } });
    expect(row.reason).toBe('opt_out_keyword');

    await suppressContact(PHONE, 'manual');
    const updated = await prisma.suppressedContact.findUniqueOrThrow({ where: { phoneNumber: PHONE } });
    // upsert com update:{} não sobrescreve o reason original
    expect(updated.reason).toBe('opt_out_keyword');
  });

  it('unsuppressContact remove a supressão', async () => {
    await suppressContact(PHONE);
    expect(await isSuppressed(PHONE)).toBe(true);
    await unsuppressContact(PHONE);
    expect(await isSuppressed(PHONE)).toBe(false);
  });

  it('unsuppressContact em número não suprimido não falha', async () => {
    await expect(unsuppressContact(PHONE)).resolves.toBeUndefined();
  });

  it('listSuppressed inclui o número gravado', async () => {
    await suppressContact(PHONE);
    const all = await listSuppressed();
    expect(all.some((s) => s.phoneNumber === PHONE)).toBe(true);
  });
});

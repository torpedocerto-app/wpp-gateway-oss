import { describe, expect, it } from 'vitest';
import { AccountStatus, MessageStatus } from '@prisma/client';

/**
 * Teste de fumaça: garante que o Prisma Client foi gerado e os enums do banco
 * batem com o esperado pelo domínio (doc 02).
 */
describe('Prisma Client', () => {
  it('expõe o enum AccountStatus com os 5 estados (doc 02 §2.1)', () => {
    expect(Object.values(AccountStatus).sort()).toEqual(
      ['BANNED', 'CONNECTED', 'DISCONNECTED', 'QR_PENDING', 'RECONNECTING'].sort(),
    );
  });

  it('expõe o enum MessageStatus com os 7 estados (doc 02 §2.4)', () => {
    expect(Object.values(MessageStatus)).toHaveLength(7);
    expect(MessageStatus.QUEUED).toBe('QUEUED');
  });
});

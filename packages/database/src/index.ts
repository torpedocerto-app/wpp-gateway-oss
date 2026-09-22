import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Cliente Prisma singleton.
 * Em dev, evita esgotar conexões a cada hot-reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export {
  SETTING_KEYS,
  getSetting,
  getSettingOr,
  setSetting,
  deleteSetting,
  listSettings,
  clearSettingsCache,
  type SettingKey,
} from './settings.js';

export {
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
  type AdminForAuth,
  type AdminIdentity,
  type AdminRow,
} from './admin-users.js';

export {
  createAdminToken,
  findUsableAdminToken,
  consumeAdminToken,
  lastResetTokenAt,
  invalidateUserTokens,
  type AdminTokenPurpose,
  type UsableAdminToken,
} from './admin-tokens.js';

export {
  isSuppressed,
  suppressContact,
  unsuppressContact,
  listSuppressed,
  type SuppressedContactRow,
} from './suppressed-contacts.js';

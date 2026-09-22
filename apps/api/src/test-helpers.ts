import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@wpp/database';

/** Gera um token válido e devolve {plain, hash}. */
export function makeToken(): { plain: string; hash: string } {
  const raw = randomBytes(24).toString('base64url').replace(/[^a-zA-Z0-9]/g, '');
  const plain = `mk_live_${raw}`;
  return { plain, hash: createHash('sha256').update(plain).digest('hex') };
}

export interface SeededProject {
  projectId: string;
  tokenPlain: string;
  cleanup: () => Promise<void>;
}

/** Cria um projeto + token de teste. Retorna o token em claro e um cleanup. */
export async function seedProject(
  over: { rateLimitPerMinute?: number; dailyQuota?: number | null; isActive?: boolean } = {},
): Promise<SeededProject> {
  const token = makeToken();
  const slug = `test-${randomBytes(4).toString('hex')}`;

  const project = await prisma.project.create({
    data: {
      name: `Test ${slug}`,
      slug,
      webhookEvents: [],
      rateLimitPerMinute: over.rateLimitPerMinute ?? 60,
      dailyQuota: over.dailyQuota ?? null,
      isActive: over.isActive ?? true,
      tokens: {
        create: {
          name: 'test',
          tokenHash: token.hash,
          tokenPrefix: token.plain.slice(0, 12),
        },
      },
    },
    select: { id: true },
  });

  return {
    projectId: project.id,
    tokenPlain: token.plain,
    cleanup: async () => {
      await prisma.message.deleteMany({ where: { projectId: project.id } });
      await prisma.apiToken.deleteMany({ where: { projectId: project.id } });
      await prisma.project.deleteMany({ where: { id: project.id } });
    },
  };
}

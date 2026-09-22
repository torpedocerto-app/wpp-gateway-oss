/**
 * Seed de desenvolvimento.
 *
 * Cria dados mínimos para operar localmente:
 *  - 1 admin (senha e TOTP configurados depois, no painel)
 *  - 1 projeto de exemplo com 1 token
 *
 * NÃO cria contas WhatsApp — elas exigem pareamento por QR (Fase 1).
 */
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Gera um token no formato mk_live_<base62> e devolve {plain, hash, prefix}. */
function generateToken(): { plain: string; hash: string; prefix: string } {
  const raw = randomBytes(32)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 43);
  const plain = `mk_live_${raw}`;
  const hash = createHash('sha256').update(plain).digest('hex');
  return { plain, hash, prefix: plain.slice(0, 12) };
}

async function main() {
  // Primeiro usuário do tenant. Os demais entram pela tela de Usuários do painel
  // (convite por email). Recuperação de acesso sem SMTP: scripts/admin-reset.sh.
  // Criar o 1º usuário de um tenant em produção: scripts/admin-create.sh.
  const admin = await prisma.adminUser.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      // placeholder — substituído no primeiro login do painel (/login/setup)
      passwordHash: 'SETUP_PENDING',
    },
  });
  console.log(`✓ admin: ${admin.email}`);

  const project = await prisma.project.upsert({
    where: { slug: 'exemplo' },
    update: {},
    create: {
      name: 'Projeto de Exemplo',
      slug: 'exemplo',
      webhookEvents: ['message.status', 'message.received'],
    },
  });
  console.log(`✓ projeto: ${project.slug}`);

  const existingToken = await prisma.apiToken.findFirst({
    where: { projectId: project.id, revokedAt: null },
  });

  if (!existingToken) {
    const token = generateToken();
    await prisma.apiToken.create({
      data: {
        projectId: project.id,
        name: 'Desenvolvimento',
        tokenHash: token.hash,
        tokenPrefix: token.prefix,
      },
    });
    console.log(`\n  🔑 Token de dev (exibido só agora): ${token.plain}\n`);
  } else {
    console.log(`✓ token já existe (prefixo ${existingToken.tokenPrefix})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // pacotes do monorepo consumidos server-side
  transpilePackages: ['@wpp/config', '@wpp/database', '@wpp/shared', '@wpp/queue', '@wpp/email'],
  serverExternalPackages: ['argon2', '@prisma/client', 'bullmq', 'ioredis', 'nodemailer'],
  // o .env é um symlink para o .env da raiz do monorepo (apps/panel/.env → ../../.env)
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    // BullMQ tem um cliente Valkey opcional que não usamos (usamos ioredis).
    config.resolve = config.resolve ?? {};
    config.resolve.alias = { ...config.resolve.alias, '@valkey/valkey-glide': false };
    return config;
  },
};

export default withNextIntl(nextConfig);

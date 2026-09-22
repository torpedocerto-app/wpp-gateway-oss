import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { env } from '@/lib/env';
import { LoginLocaleSwitcher } from '../login/locale-switcher-login';

/**
 * Acessível a quem tem o link, invisível para buscador. Indexada, esta página
 * — rica em texto e servida sem sessão — permitiria descobrir por busca todos
 * os deploys deste gateway. Reforça o /robots.txt (app/robots.ts); remova as
 * duas coisas se quiser que a sua instância seja encontrável.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Layout da documentação pública (/docs/*) — sem sessão, com seletor de idioma. */
export default async function DocsLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations('apiDocs');

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <header className="docs-header">
        <Link href="/docs/api" style={{ fontWeight: 700, color: 'var(--text)' }}>
          {env.PANEL_BRAND_NAME} · {t('brandSuffix')}
        </Link>
        <LoginLocaleSwitcher current={locale} absolute={false} />
      </header>
      {children}
    </div>
  );
}

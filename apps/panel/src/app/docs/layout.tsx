import type { ReactNode } from 'react';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { env } from '@/lib/env';
import { LoginLocaleSwitcher } from '../login/locale-switcher-login';

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

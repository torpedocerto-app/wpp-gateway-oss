import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { htmlLang, isLocale } from '@/i18n/routing';
import './globals.css';

// Metadata é cosmética e roda no prerender do build (antes das env vars de
// runtime existirem). Lê process.env cru com fallback — NÃO usa loadEnv(),
// que lançaria por faltar DATABASE_URL etc. durante o build.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  return {
    title: process.env.PANEL_BRAND_NAME || t('title'),
    description: t('description'),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const lang = isLocale(locale) ? htmlLang[locale] : 'pt-BR';

  return (
    <html lang={lang}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

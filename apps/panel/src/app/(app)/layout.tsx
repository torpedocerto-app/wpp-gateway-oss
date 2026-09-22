import type { ReactNode } from 'react';
import Link from 'next/link';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { env } from '@/lib/env';
import { requireSession } from '@/lib/auth';
import { isLocale } from '@/i18n/routing';
import { LogoutButton } from './logout-button';
import { LocaleSwitcher } from './locale-switcher';

/** Layout das páginas autenticadas — protege tudo abaixo de (app). */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireSession();

  // O idioma do usuário (admin_users.locale) prevalece sobre o cookie/header
  // para todas as páginas e Client Components abaixo de (app).
  if (isLocale(me.locale)) setRequestLocale(me.locale);
  const messages = await getMessages();
  const t = await getTranslations('nav');

  return (
    <NextIntlClientProvider locale={me.locale} messages={messages}>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">{env.PANEL_BRAND_NAME}</div>
          <nav>
            <Link href="/">{t('dashboard')}</Link>
            <Link href="/chat">{t('chat')}</Link>
            <Link href="/accounts">{t('accounts')}</Link>
            <Link href="/messages">{t('messages')}</Link>
            <Link href="/queue">{t('queue')}</Link>
            <Link href="/alerts">{t('alerts')}</Link>
            <Link href="/opt-out">{t('optOut')}</Link>
            <Link href="/projects">{t('projects')}</Link>
            <Link href="/users">{t('users')}</Link>
            <Link href="/settings">{t('settings')}</Link>
          </nav>
          <div style={{ marginTop: 24, padding: '0 8px' }}>
            <p className="muted" style={{ fontSize: 12, marginBottom: 8, wordBreak: 'break-all' }}>
              {me.email}
            </p>
            <LocaleSwitcher current={me.locale} />
            <LogoutButton />
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </NextIntlClientProvider>
  );
}

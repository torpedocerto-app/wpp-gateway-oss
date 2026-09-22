import type { ReactNode } from 'react';
import { getLocale } from 'next-intl/server';
import { LoginLocaleSwitcher } from './locale-switcher-login';

/** Envolve as telas de login/forgot/reset/setup — hospeda o seletor de idioma. */
export default async function LoginLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <LoginLocaleSwitcher current={locale} />
      {children}
    </div>
  );
}

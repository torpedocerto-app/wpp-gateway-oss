import { defineRouting } from 'next-intl/routing';

/**
 * i18n do painel — 3 idiomas, SEM prefixo de locale na URL (`/users`, não
 * `/es/users`). O locale ativo vem de, em ordem:
 *   1. admin_users.locale do usuário logado  (aplicado em (app)/layout.tsx)
 *   2. cookie NEXT_LOCALE                     (telas de login, sem sessão)
 *   3. Accept-Language do navegador
 *   4. PANEL_DEFAULT_LOCALE do env            (fallback do tenant)
 */

export const locales = ['pt', 'es', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'pt';

/** BCP-47 para o atributo <html lang>. 'pt' segue emitindo 'pt-BR'. */
export const htmlLang: Record<Locale, string> = {
  pt: 'pt-BR',
  es: 'es',
  en: 'en',
};

/** Nomes nativos para os seletores de idioma. */
export const localeNames: Record<Locale, string> = {
  pt: 'Português',
  es: 'Español',
  en: 'English',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'never',
  localeCookie: { name: 'NEXT_LOCALE' },
});

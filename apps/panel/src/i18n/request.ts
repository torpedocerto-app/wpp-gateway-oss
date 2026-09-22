import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { defaultLocale, isLocale, type Locale } from './routing';

/**
 * Resolve o locale PRÉ-SESSÃO (cookie → Accept-Language → PANEL_DEFAULT_LOCALE).
 * NÃO acessa o banco — o locale do usuário logado é aplicado por cima em
 * (app)/layout.tsx via setRequestLocale(me.locale) + <NextIntlClientProvider>.
 *
 * Lê process.env cru (não loadEnv()) porque roda também no prerender do build,
 * antes das env vars de runtime — mesma restrição do generateMetadata do painel.
 */

async function resolvePreSessionLocale(): Promise<Locale> {
  const jar = await cookies();
  const cookieLocale = jar.get('NEXT_LOCALE')?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  const accept = (await headers()).get('accept-language');
  const primary = accept?.split(',')[0]?.trim().slice(0, 2).toLowerCase();
  if (isLocale(primary)) return primary;

  const envLocale = process.env.PANEL_DEFAULT_LOCALE;
  if (isLocale(envLocale)) return envLocale;

  return defaultLocale;
}

/**
 * Mesmo motivo do locale acima: lê `process.env` cru (não `loadEnv()`) porque
 * este arquivo roda também no prerender do build, antes das env vars de
 * runtime existirem. Sem isto, `format.dateTime()` cai no timezone do
 * SERVIDOR (UTC) em vez do timezone do tenant — a causa do "aparece 5h a
 * mais" pra quem está na Colômbia.
 */
function resolveTimeZone(): string {
  const tz = process.env.TENANT_TIMEZONE;
  if (!tz) return 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export default getRequestConfig(async () => {
  const locale = await resolvePreSessionLocale();
  const timeZone = resolveTimeZone();

  return {
    locale,
    timeZone,
    messages: (await import(`../../messages/${locale}.json`)).default,
    formats: {
      dateTime: {
        short: {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone,
        },
        date: { day: '2-digit', month: '2-digit', year: 'numeric', timeZone },
        time: { hour: '2-digit', minute: '2-digit', timeZone },
      },
      number: {
        percent: { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 },
      },
    },
  };
});

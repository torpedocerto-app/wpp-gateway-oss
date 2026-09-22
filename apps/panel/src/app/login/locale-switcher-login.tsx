'use client';

import { useRouter } from 'next/navigation';
import { locales, localeNames, type Locale } from '@/i18n/routing';

/**
 * Seletor de idioma para páginas sem sessão (login, docs públicas): só grava
 * o cookie. `absolute` (default true) posiciona no canto — desligue quando o
 * seletor já está dentro de um header com seu próprio layout (ex: /docs).
 */
export function LoginLocaleSwitcher({
  current,
  absolute = true,
}: {
  current: string;
  absolute?: boolean;
}) {
  const router = useRouter();

  return (
    <select
      aria-label="Idioma"
      value={current}
      onChange={(e) => {
        document.cookie = `NEXT_LOCALE=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
      style={absolute ? { position: 'absolute', top: 16, right: 16, fontSize: 13 } : { fontSize: 13 }}
    >
      {locales.map((l: Locale) => (
        <option key={l} value={l}>
          {localeNames[l]}
        </option>
      ))}
    </select>
  );
}

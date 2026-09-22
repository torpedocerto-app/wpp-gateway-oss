'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { locales, localeNames, type Locale } from '@/i18n/routing';
import { setMyLocaleAction } from '@/app/actions/locale';

export function LocaleSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label="Idioma"
      value={current}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        startTransition(async () => {
          await setMyLocaleAction(next);
          router.refresh();
        });
      }}
      style={{ width: '100%', marginBottom: 8 }}
    >
      {locales.map((l: Locale) => (
        <option key={l} value={l}>
          {localeNames[l]}
        </option>
      ))}
    </select>
  );
}

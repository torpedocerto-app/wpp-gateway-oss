'use client';

import { useTranslations } from 'next-intl';
import { logoutAction } from '@/app/actions/auth';

export function LogoutButton() {
  const t = useTranslations('nav');
  return (
    <form action={logoutAction}>
      <button type="submit" style={{ width: '100%' }}>
        {t('logout')}
      </button>
    </form>
  );
}

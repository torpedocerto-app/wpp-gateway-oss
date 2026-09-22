'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { reactivateContactAction } from '@/app/actions/opt-out';

export function ReactivateButton({ phoneNumber }: { phoneNumber: string }) {
  const t = useTranslations('optOut');
  const [pending, start] = useTransition();

  return (
    <button
      disabled={pending}
      title={t('reactivateTitle')}
      onClick={() => start(() => reactivateContactAction(phoneNumber))}
    >
      {t('reactivate')}
    </button>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { suppressContactAction } from '@/app/actions/opt-out';

export function AddSuppressionForm() {
  const t = useTranslations('optOut');
  const [msg, setMsg] = useState<{ error?: string; ok?: boolean } | null>(null);

  return (
    <form
      action={async (fd) => {
        const res = await suppressContactAction(fd);
        setMsg(res);
        if (res.ok) (document.getElementById('phone') as HTMLInputElement | null)?.form?.reset();
      }}
    >
      <label htmlFor="phone">{t('addTitle')}</label>
      <div className="row">
        <input id="phone" name="phone" placeholder={t('addPlaceholder')} style={{ width: 260 }} />
        <button className="primary" type="submit">
          {t('addButton')}
        </button>
      </div>
      {msg?.error && <div className="error">{msg.error}</div>}
    </form>
  );
}

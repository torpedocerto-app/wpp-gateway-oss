'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createProjectAction } from '@/app/actions/projects';

export function NewProjectForm() {
  const t = useTranslations('projects');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setError(null);
    const r = await createProjectAction(formData);
    if (r.error) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <form action={submit} className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div>
        <label htmlFor="name">{t('fieldName')}</label>
        <input id="name" name="name" placeholder={t('namePlaceholder')} required style={{ width: 200 }} />
      </div>
      <div>
        <label htmlFor="slug">{t('fieldSlug')}</label>
        <input id="slug" name="slug" placeholder={t('slugPlaceholder')} required style={{ width: 160 }} />
      </div>
      <button className="primary" type="submit">
        {t('create')}
      </button>
      {error && <div className="error">{error}</div>}
    </form>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { ForgotForm } from './forgot-form';

export default async function ForgotPage() {
  if (await getSession()) redirect('/');
  const t = await getTranslations('login');

  return (
    <div className="center-page">
      <div className="card auth-card">
        <h1>{t('recoverTitle')}</h1>
        <p className="subtitle">{t('panelOf', { brand: env.PANEL_BRAND_NAME })}</p>
        <ForgotForm />
        <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>
          <Link href="/login">{t('backToLogin')}</Link>
        </p>
      </div>
    </div>
  );
}

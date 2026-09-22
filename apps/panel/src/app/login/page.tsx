import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  if (await getSession()) redirect('/');
  const { reset } = await searchParams;
  const t = await getTranslations('login');

  return (
    <div className="center-page">
      <div className="card auth-card">
        <h1>{t('signIn')}</h1>
        <p className="subtitle">{t('panelOf', { brand: env.PANEL_BRAND_NAME })}</p>
        {reset && <div className="ok">{t('passwordReset')}</div>}
        <LoginForm />
      </div>
    </div>
  );
}

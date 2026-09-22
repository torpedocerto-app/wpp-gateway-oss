import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { findUsableAdminToken } from '@wpp/database';
import { hashToken } from '@wpp/email';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { ResetForm } from './reset-form';

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  if (await getSession()) redirect('/');
  const { token } = await params;
  const row = await findUsableAdminToken(hashToken(token), 'RESET');
  const t = await getTranslations('login');

  if (!row || row.user.disabledAt) {
    return (
      <div className="center-page">
        <div className="card auth-card">
          <h1>{t('invalidLinkTitle')}</h1>
          <p className="subtitle">{t('invalidLinkText')}</p>
          <p className="muted" style={{ marginTop: 12 }}>
            <Link href="/login/forgot">{t('requestNewLink')}</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="center-page">
      <div className="card auth-card">
        <h1>{t('newPasswordTitle')}</h1>
        <p className="subtitle">{t('panelOf', { brand: env.PANEL_BRAND_NAME })}</p>
        <ResetForm token={token} />
      </div>
    </div>
  );
}

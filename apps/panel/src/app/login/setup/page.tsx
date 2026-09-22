import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { findUsableAdminToken } from '@wpp/database';
import { hashToken } from '@wpp/email';
import { getBootstrapAdmin, BootstrapError } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { SetupFlow } from './setup-flow';

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (await getSession()) redirect('/');
  const { token } = await searchParams;
  const t = await getTranslations('setup');

  let email: string;
  if (token) {
    const row = await findUsableAdminToken(hashToken(token), 'INVITE');
    if (!row || row.user.disabledAt) {
      return (
        <div className="center-page">
          <div className="card auth-card">
            <h1>{t('inviteInvalidTitle')}</h1>
            <p className="subtitle">{t('inviteInvalidText')}</p>
          </div>
        </div>
      );
    }
    email = row.user.email;
  } else {
    try {
      email = (await getBootstrapAdmin()).email;
    } catch (e) {
      if (e instanceof BootstrapError) {
        return (
          <div className="center-page">
            <div className="card auth-card">
              <h1>{t('firstAccess')}</h1>
              <p className="subtitle">{t(e.code)}</p>
            </div>
          </div>
        );
      }
      redirect('/login');
    }
  }

  return (
    <div className="center-page">
      <div className="card auth-card">
        <h1>{token ? t('acceptInvite') : t('firstAccess')}</h1>
        <p className="subtitle">{t('setPasswordAnd2faFor', { email })}</p>
        <SetupFlow token={token} />
      </div>
    </div>
  );
}

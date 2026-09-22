import { getTranslations, getFormatter } from 'next-intl/server';
import { listAdmins, needsSetup } from '@wpp/database';
import { isEmailConfigured } from '@wpp/email';
import { requireSession } from '@/lib/auth';
import { InviteUserForm } from './invite-user-form';
import { UserRowActions } from './user-row-actions';
import { ChangeMyPasswordForm } from './change-my-password-form';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const me = await requireSession();
  const users = await listAdmins();
  const smtpOk = isEmailConfigured();
  const t = await getTranslations('users');
  const format = await getFormatter();

  function statusOf(u: { passwordHash: string; disabledAt: Date | null }): string {
    if (u.disabledAt) return t('statusDisabled');
    if (needsSetup(u.passwordHash)) return t('statusPendingInvite');
    return t('statusActive');
  }

  return (
    <>
      <h1>{t('title')}</h1>
      <p className="subtitle">{t('subtitle')}</p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('myAccount')}</h3>
        <p className="muted">
          {me.email}
          {me.name ? ` — ${me.name}` : ''}
        </p>
        <ChangeMyPasswordForm />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('count', { n: users.length })}</h3>
        <table>
          <thead>
            <tr>
              <th>{t('colEmail')}</th>
              <th>{t('colName')}</th>
              <th>{t('col2fa')}</th>
              <th>{t('colStatus')}</th>
              <th>{t('colLastLogin')}</th>
              <th>{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td className="muted">{u.name ?? '—'}</td>
                <td>{u.totpEnabled ? '✓' : '—'}</td>
                <td>{statusOf(u)}</td>
                <td className="muted">
                  {u.lastLoginAt ? format.dateTime(u.lastLoginAt, 'short') : '—'}
                </td>
                <td>
                  <UserRowActions
                    userId={u.id}
                    isSelf={u.id === me.userId}
                    disabled={Boolean(u.disabledAt)}
                    pendingInvite={needsSetup(u.passwordHash)}
                    smtpOk={smtpOk}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('inviteUser')}</h3>
        {!smtpOk && <p className="error">{t('smtpNotConfigured')}</p>}
        <InviteUserForm disabled={!smtpOk} />
      </div>
    </>
  );
}

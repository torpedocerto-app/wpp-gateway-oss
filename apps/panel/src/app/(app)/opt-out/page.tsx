import { getTranslations, getFormatter } from 'next-intl/server';
import { listSuppressed } from '@wpp/database';
import { ReactivateButton } from './reactivate-button';
import { AddSuppressionForm } from './add-suppression-form';

export const dynamic = 'force-dynamic';

export default async function OptOutPage() {
  const suppressed = await listSuppressed();
  const t = await getTranslations('optOut');
  const format = await getFormatter();

  return (
    <>
      <h1>{t('title')}</h1>
      <p className="subtitle">{t('subtitle')}</p>

      <div className="card">
        <AddSuppressionForm />
      </div>

      <div className="card">
        {suppressed.length === 0 ? (
          <p className="muted">{t('noSuppressed')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('colPhone')}</th>
                <th>{t('colReason')}</th>
                <th>{t('colSince')}</th>
                <th>{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {suppressed.map((s) => (
                <tr key={s.id}>
                  <td>{s.phoneNumber}</td>
                  <td className="muted">
                    {s.reason === 'opt_out_keyword' ? t('reasonKeyword') : t('reasonManual')}
                  </td>
                  <td className="muted">{format.dateTime(s.createdAt, 'short')}</td>
                  <td>
                    <ReactivateButton phoneNumber={s.phoneNumber} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

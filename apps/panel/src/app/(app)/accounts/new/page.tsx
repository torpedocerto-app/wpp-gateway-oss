import { getTranslations } from 'next-intl/server';
import { NewAccountWizard } from './wizard';

export default async function NewAccountPage() {
  const t = await getTranslations('accounts');
  return (
    <>
      <h1>{t('newTitle')}</h1>
      <p className="subtitle">{t('newSubtitle')}</p>
      <div className="card" style={{ maxWidth: 480 }}>
        <NewAccountWizard warmupDays={7} />
      </div>
    </>
  );
}

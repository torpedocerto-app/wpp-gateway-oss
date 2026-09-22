import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations, getFormatter } from 'next-intl/server';
import { prisma } from '@wpp/database';
import { webhookDeliveryStatusLabel } from '@/i18n/labels';


import { ProjectConfig } from './project-config';
import { TokenManager } from './token-manager';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      tokens: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!project) notFound();

  const deliveries = await prisma.webhookDelivery.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const t = await getTranslations('projects');
  const tQueue = await getTranslations('queue');
  const tRoot = await getTranslations();
  const format = await getFormatter();

  return (
    <>
      <p>
        <Link href="/projects">{t('detailBack')}</Link>
      </p>
      <h1>{project.name}</h1>
      <p className="subtitle">slug: {project.slug}</p>

      <ProjectConfig
        id={project.id}
        webhookUrl={project.webhookUrl}
        hasSecret={Boolean(project.webhookSecret)}
        webhookEvents={project.webhookEvents}
        rateLimitPerMinute={project.rateLimitPerMinute}
        dailyQuota={project.dailyQuota}
        isActive={project.isActive}
      />

      <TokenManager
        projectId={project.id}
        tokens={project.tokens.map((tok) => ({
          id: tok.id,
          name: tok.name,
          prefix: tok.tokenPrefix,
          lastUsedAt: tok.lastUsedAt?.toISOString() ?? null,
          revokedAt: tok.revokedAt?.toISOString() ?? null,
        }))}
      />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('lastDeliveries')}</h3>
        {deliveries.length === 0 ? (
          <p className="muted">{t('noDeliveries')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('colEvent')}</th>
                <th>{t('colStatus')}</th>
                <th>{t('colHttp')}</th>
                <th>{tQueue('colAttempts')}</th>
                <th>{t('colWhen')}</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td>{d.eventType}</td>
                  <td>{webhookDeliveryStatusLabel(tRoot, d.status)}</td>
                  <td>{d.httpStatus ?? '—'}</td>
                  <td>{d.attemptCount}</td>
                  <td className="muted">{format.dateTime(d.createdAt, 'short')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

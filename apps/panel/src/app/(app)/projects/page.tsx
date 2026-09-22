import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@wpp/database';
import { NewProjectForm } from './new-project-form';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { tokens: true, messages: true } } },
  });
  const t = await getTranslations('projects');

  return (
    <>
      <h1>{t('title')}</h1>
      <p className="subtitle">{t('subtitle')}</p>

      <div className="card">
        {projects.length === 0 ? (
          <p className="muted">{t('noProjects')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('colName')}</th>
                <th>{t('colSlug')}</th>
                <th>{t('colTokens')}</th>
                <th>{t('colMessages')}</th>
                <th>{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}`}>{p.name}</Link>
                  </td>
                  <td className="muted">{p.slug}</td>
                  <td>{p._count.tokens}</td>
                  <td>{p._count.messages}</td>
                  <td>{p.isActive ? t('statusActive') : t('statusInactive')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('newProject')}</h3>
        <NewProjectForm />
      </div>
    </>
  );
}

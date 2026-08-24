import { notFound } from 'next/navigation';
import { ClipboardCheck, Code, Rocket, Users } from 'lucide-react';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/server';
import { getSofliaInboxEnv } from '@/lib/server/env';
import { resolveTenantContext } from '@/lib/server/tenant-context';
import { getAdminDashboardData } from '@/domains/admin-dashboard/dashboard-data';
import { DashboardStatCard } from '@/domains/admin-dashboard/components/DashboardStatCard';
import { CreationTrendChart, PipelineDistributionBars } from '@/domains/admin-dashboard/components/PipelineCharts';
import { RecentArtifactsFeed } from '@/domains/admin-dashboard/components/RecentArtifactsFeed';
import { AttentionQueue } from '@/domains/admin-dashboard/components/AttentionQueue';
import { QuickCreateCard } from '@/domains/admin-dashboard/components/QuickCreateCard';

export default async function TenantAdminPage({
  params,
}: {
  params: Promise<{ empresaSlug: string }>;
}) {
  const { empresaSlug } = await params;
  const tenant = await resolveTenantContext(empresaSlug);
  if (!tenant) notFound();

  const supabase = await createClient();
  const sofliaEnv = getSofliaInboxEnv();
  const sofliaAdmin = createAdminClient(sofliaEnv.url, sofliaEnv.key);
  const { count: totalUsers } = await sofliaAdmin
    .from('organization_users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', tenant.organizationId)
    .in('status', ['active', 'invited']);

  const basePath = `/${tenant.organizationSlug}/admin`;
  const dashboard = await getAdminDashboardData({
    supabase,
    organizationId: tenant.organizationId,
    basePath,
    activeUsers: totalUsers ?? 0,
  });

  const { stats } = dashboard;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Visión General</h1>
        <p className="text-gray-600 dark:text-[var(--engine-text-muted)]">Centro de control de SofLIA - Engine para esta empresa.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <DashboardStatCard
          title="Usuarios de esta empresa"
          value={stats.activeUsers.toLocaleString()}
          hint="Activos e invitados"
          icon={Users}
        />
        <DashboardStatCard
          title="Artefactos generados"
          value={stats.totalArtifacts.toLocaleString()}
          hint={
            stats.artifactsCreatedThisWeek > 0
              ? `+${stats.artifactsCreatedThisWeek} esta semana`
              : 'Sin nuevos esta semana'
          }
          tone={stats.artifactsCreatedThisWeek > 0 ? 'positive' : 'neutral'}
          icon={Code}
          iconClassName="text-[var(--engine-info)]"
        />
        <DashboardStatCard
          title="Cursos en proceso"
          value={stats.inProgressCount.toLocaleString()}
          hint={
            stats.escalatedCount > 0
              ? `${stats.escalatedCount} escalado${stats.escalatedCount === 1 ? '' : 's'} requiere revisión`
              : stats.activeRenderCount > 0
                ? `${stats.activeRenderCount} en render de video`
                : 'Sin bloqueos activos'
          }
          tone={stats.escalatedCount > 0 ? 'attention' : 'neutral'}
          icon={ClipboardCheck}
          iconClassName="text-purple-400"
        />
        <DashboardStatCard
          title="Publicaciones pendientes"
          value={(stats.publicationReadyCount + stats.publicationSentCount).toLocaleString()}
          hint={`${stats.publicationReadyCount} listas · ${stats.publicationSentCount} enviadas`}
          tone="neutral"
          icon={Rocket}
          iconClassName="text-orange-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-[var(--engine-muted)]/10 rounded-2xl p-6 shadow-sm dark:shadow-none transition-colors">
          <CreationTrendChart data={dashboard.creationTrend} />
        </div>
        <div className="bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-[var(--engine-muted)]/10 rounded-2xl p-6 shadow-sm dark:shadow-none transition-colors">
          <PipelineDistributionBars buckets={dashboard.pipelineDistribution} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <RecentArtifactsFeed artifacts={dashboard.recentArtifacts} basePath={basePath} />
        </div>

        <div className="space-y-6">
          <QuickCreateCard href={`${basePath}/artifacts/new`} />
          <AttentionQueue items={dashboard.attentionItems} />
        </div>
      </div>
    </div>
  );
}

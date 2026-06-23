import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, ClipboardCheck, Code, Rocket, UserPlus, Users } from 'lucide-react';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/server';
import { getSofliaInboxEnv } from '@/lib/server/env';
import { resolveTenantContext } from '@/lib/server/tenant-context';

interface LoginHistoryRow {
  login_at: string;
  user_id: string;
}

interface RecentProfileRow {
  email?: string | null;
  first_name?: string | null;
  id: string;
  last_name_father?: string | null;
  username?: string | null;
}

interface RecentUser extends RecentProfileRow {
  last_seen_at?: string | null;
}

interface StatCardProps {
  icon: React.ReactNode;
  positive?: boolean;
  title: string;
  trend: string;
  val: string;
}

const ARTIFACT_IN_PROGRESS_STATES = [
  'GENERATING',
  'VALIDATING',
  'IN_PROCESS',
  'SCORM_PARSING',
  'SCORM_ENRICHING',
  'SCORM_TRANSFORMING',
];

const ARTIFACT_QA_STATES = [
  'READY_FOR_QA',
  'STEP_READY_FOR_QA',
  'STEP_READY_FOR_REVIEW',
  'ESCALATED',
  'SCORM_READY_FOR_QA',
];

const PUBLICATION_PENDING_STATUSES = ['READY', 'SENT'];
const SCORM_ATTENTION_STATUSES = [
  'SCORM_UPLOADED',
  'SCORM_PARSING',
  'SCORM_ANALYZED',
  'SCORM_ENRICHING',
  'TRANSFORMING',
  'FAILED',
];

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

  const { count: artifactsCount } = await supabase
    .from('artifacts')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', tenant.organizationId);

  const { count: inProgressCount } = await supabase
    .from('artifacts')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', tenant.organizationId)
    .in('state', ARTIFACT_IN_PROGRESS_STATES);

  const { count: qaPendingCount } = await supabase
    .from('artifacts')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', tenant.organizationId)
    .in('state', ARTIFACT_QA_STATES);

  const { count: publicationPendingCount } = await supabase
    .from('publication_requests')
    .select('id, artifacts!inner(organization_id)', { count: 'exact', head: true })
    .eq('artifacts.organization_id', tenant.organizationId)
    .in('status', PUBLICATION_PENDING_STATUSES);

  const { count: scormAttentionCount } = await supabase
    .from('scorm_imports')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', tenant.organizationId)
    .in('status', SCORM_ATTENTION_STATUSES);

  const basePath = `/${tenant.organizationSlug}/admin`;
  const { data: organizationUsers } = await sofliaAdmin
    .from('organization_users')
    .select('user_id')
    .eq('organization_id', tenant.organizationId)
    .in('status', ['active', 'invited']);
  const organizationUserIds = (organizationUsers || [])
    .map((user) => user.user_id as string | null)
    .filter((userId): userId is string => Boolean(userId));

  const { data: recentLogins } = organizationUserIds.length > 0
    ? await supabase
      .from('login_history')
      .select('user_id, login_at')
      .in('user_id', organizationUserIds)
      .order('login_at', { ascending: false })
      .limit(20)
    : { data: [] as LoginHistoryRow[] };

  const uniqueLogins = new Map<string, string>();
  (recentLogins as LoginHistoryRow[] | null)?.forEach((log) => {
    if (!uniqueLogins.has(log.user_id)) {
      uniqueLogins.set(log.user_id, log.login_at);
    }
  });

  const topUserIds = Array.from(uniqueLogins.keys()).slice(0, 5);
  const { data: profilesData } = topUserIds.length > 0
    ? await supabase
      .from('profiles')
      .select('id, first_name, last_name_father, username, email')
      .in('id', topUserIds)
    : { data: [] as RecentProfileRow[] };

  const recentUsers: RecentUser[] = [];
  for (const id of topUserIds) {
    const profile = profilesData?.find((item) => item.id === id);
    if (!profile) continue;

    recentUsers.push({
      ...profile,
      last_seen_at: uniqueLogins.get(id) ?? undefined,
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Visión General</h1>
        <p className="text-gray-600 dark:text-[#94A3B8]">Centro de control de SofLIA - Engine para esta empresa.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Usuarios de esta empresa"
          val={totalUsers?.toLocaleString() || '0'}
          trend="Actualizado"
          icon={<Users className="text-[#00D4B3]" size={24} />}
        />
        <StatCard
          title="Artefactos generados"
          val={(artifactsCount ?? 0).toLocaleString()}
          trend="Tenant"
          positive
          icon={<Code className="text-[#1F5AF6]" size={24} />}
        />
        <StatCard
          title="Cursos en proceso"
          val={(inProgressCount ?? 0).toLocaleString()}
          trend="Pipeline"
          icon={<ClipboardCheck className="text-purple-400" size={24} />}
        />
        <StatCard
          title="Publicaciones pendientes"
          val={(publicationPendingCount ?? 0).toLocaleString()}
          trend="SofLIA"
          positive
          icon={<Rocket className="text-orange-400" size={24} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 shadow-sm dark:shadow-none transition-colors">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Usuarios Activos Recientemente</h3>
            <Link href={`${basePath}/users`} className="text-sm text-[#00D4B3] hover:underline">Ver todo</Link>
          </div>
          <div className="space-y-4">
            {recentUsers.map((user) => (
              <div key={user.id} className="flex items-center gap-4 p-3 hover:bg-gray-50 dark:hover:bg-[#1E2329] rounded-xl transition-colors cursor-default group border border-transparent hover:border-gray-100 dark:hover:border-transparent">
                <div className="w-10 h-10 rounded-full bg-[#00D4B3]/10 flex items-center justify-center text-[#00D4B3]">
                  <UserPlus size={18} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-[#00D4B3] transition-colors">
                    {user.first_name} {user.last_name_father} ({user.username || 'Sin usuario'})
                  </p>
                  <p className="text-xs text-gray-500 dark:text-[#94A3B8]">{user.email}</p>
                </div>
                <div className="text-xs text-gray-400 dark:text-[#6C757D]">
                  {user.last_seen_at ? timeAgo(user.last_seen_at) : 'Recién registrado'}
                </div>
              </div>
            ))}

            {recentUsers.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-4">No hay actividad reciente para esta empresa.</p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <Link href={`${basePath}/artifacts/new`} className="block">
            <div className="bg-[#0A2540] border border-[#1F5AF6]/30 rounded-2xl p-6 relative overflow-hidden group hover:border-[#1F5AF6] transition-all cursor-pointer shadow-lg">
              <div className="absolute top-[-20%] right-[-20%] w-[150px] h-[150px] bg-[#1F5AF6]/20 rounded-full blur-[40px]" />
              <h3 className="text-lg font-bold text-white mb-2 relative z-10">Nuevo Artefacto</h3>
              <p className="text-sm text-[#94A3B8] mb-4 relative z-10">Crear un nuevo curso para esta empresa.</p>
              <div className="w-10 h-10 bg-[#1F5AF6] rounded-full flex items-center justify-center text-white relative z-10 group-hover:scale-110 transition-transform">
                <ArrowUpRight size={20} />
              </div>
            </div>
          </Link>

          <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 shadow-sm dark:shadow-none transition-colors">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Cola Operativa</h3>
            <div className="space-y-3">
              <QueueItem
                href={`${basePath}/artifacts`}
                label="Pendientes de QA"
                value={qaPendingCount ?? 0}
                tone={(qaPendingCount ?? 0) > 0 ? 'attention' : 'ok'}
              />
              <QueueItem
                href={`${basePath}/artifacts`}
                label="Listos/enviados a SofLIA"
                value={publicationPendingCount ?? 0}
                tone={(publicationPendingCount ?? 0) > 0 ? 'attention' : 'ok'}
              />
              <QueueItem
                href={`${basePath}/artifacts/new`}
                label="SCORM por revisar"
                value={scormAttentionCount ?? 0}
                tone={(scormAttentionCount ?? 0) > 0 ? 'warning' : 'ok'}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function timeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `Hace ${seconds} seg`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days} días`;
}

function StatCard({ title, val, trend, icon, positive = true }: StatCardProps) {
  return (
    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-5 hover:border-gray-300 dark:hover:border-[#6C757D]/30 transition-all shadow-sm dark:shadow-none">
      <div className="flex items-start justify-between mb-4">
        <div className="p-2 bg-gray-50 dark:bg-[#0F1419] rounded-lg border border-gray-100 dark:border-[#6C757D]/10">
          {icon}
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${positive ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
          {trend}
        </span>
      </div>
      <div>
        <p className="text-sm text-gray-500 dark:text-[#94A3B8] mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{val}</h3>
      </div>
    </div>
  );
}

function QueueItem({
  href,
  label,
  tone,
  value,
}: {
  href: string;
  label: string;
  tone: 'attention' | 'ok' | 'warning';
  value: number;
}) {
  const isOk = tone === 'ok';
  const toneClass = tone === 'warning'
    ? 'text-amber-600 dark:text-amber-400'
    : isOk
      ? 'text-green-600 dark:text-green-400'
      : 'text-[#1F5AF6] dark:text-blue-400';

  return (
    <Link href={href} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-[#1E2329] transition-colors">
      <span className="flex items-center gap-2 text-sm text-gray-600 dark:text-[#94A3B8]">
        {tone === 'warning' && <AlertTriangle size={14} className={toneClass} />}
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold ${toneClass}`}>
          {value.toLocaleString()}
        </span>
        <span className={`w-2 h-2 rounded-full ${isOk ? 'bg-green-500 dark:bg-green-400' : 'bg-amber-500 dark:bg-amber-400 animate-pulse'}`} />
      </div>
    </Link>
  );
}

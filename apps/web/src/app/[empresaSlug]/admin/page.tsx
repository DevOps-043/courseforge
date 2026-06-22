import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowUpRight, Code, Users } from 'lucide-react';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/server';
import { getSofliaInboxEnv } from '@/lib/server/env';
import { resolveTenantContext } from '@/lib/server/tenant-context';

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

  const basePath = `/${tenant.organizationSlug}/admin`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Vision General</h1>
        <p className="text-gray-600 dark:text-[#94A3B8]">Centro de control de CourseForge para esta empresa.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <Users className="text-[#00D4B3]" size={24} />
            <p className="text-sm text-gray-500 dark:text-[#94A3B8]">Usuarios Totales</p>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{totalUsers?.toLocaleString() || '0'}</p>
        </div>

        <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <Code className="text-[#1F5AF6]" size={24} />
            <p className="text-sm text-gray-500 dark:text-[#94A3B8]">Artefactos de esta empresa</p>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{(artifactsCount ?? 0).toLocaleString()}</p>
        </div>
      </div>

      <Link href={`${basePath}/artifacts/new`} className="block max-w-sm">
        <div className="bg-[#0A2540] border border-[#1F5AF6]/30 rounded-2xl p-6 relative overflow-hidden group hover:border-[#1F5AF6] transition-all cursor-pointer shadow-lg">
          <h3 className="text-lg font-bold text-white mb-2 relative z-10">Nuevo Artefacto</h3>
          <p className="text-sm text-[#94A3B8] mb-4 relative z-10">Crear un nuevo curso para esta empresa.</p>
          <div className="w-10 h-10 bg-[#1F5AF6] rounded-full flex items-center justify-center text-white relative z-10 group-hover:scale-110 transition-transform">
            <ArrowUpRight size={20} />
          </div>
        </div>
      </Link>
    </div>
  );
}

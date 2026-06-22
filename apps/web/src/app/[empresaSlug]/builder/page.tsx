import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Plus } from 'lucide-react';
import { resolveTenantContext } from '@/lib/server/tenant-context';

export default async function TenantConstructorDashboardPage({
  params,
}: {
  params: Promise<{ empresaSlug: string }>;
}) {
  const { empresaSlug } = await params;
  const tenant = await resolveTenantContext(empresaSlug);
  if (!tenant) notFound();

  const basePath = `/${tenant.organizationSlug}/builder`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[#0A2540] to-[#151A21] p-6 rounded-2xl border border-[#1F5AF6]/20 relative overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-1">Tu Espacio de Trabajo</h1>
          <p className="text-[#94A3B8] text-sm">Trabaja en los proyectos asignados para esta empresa.</p>
        </div>
        <Link href={`${basePath}/artifacts/new`} className="relative z-10 bg-[#1F5AF6] hover:bg-[#1a4bd6] text-white px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-[#1F5AF6]/20 group">
          <Plus size={18} className="group-hover:rotate-90 transition-transform" />
          Crear Proyecto
        </Link>
      </div>

      <Link href={`${basePath}/artifacts`} className="block p-6 bg-white dark:bg-[#151A21] rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm">
        <h3 className="text-sm text-gray-500 font-semibold uppercase tracking-wider">Flujos Incompletos</h3>
        <p className="text-3xl font-bold text-gray-900 dark:text-white">Explorar asignaciones</p>
        <p className="text-xs text-gray-400">Continua trabajando donde lo dejaste.</p>
      </Link>
    </div>
  );
}

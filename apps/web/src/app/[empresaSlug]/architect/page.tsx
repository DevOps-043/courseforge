import Link from 'next/link';
import { notFound } from 'next/navigation';
import { resolveTenantContext } from '@/lib/server/tenant-context';

export default async function TenantArchitectDashboardPage({
  params,
}: {
  params: Promise<{ empresaSlug: string }>;
}) {
  const { empresaSlug } = await params;
  const tenant = await resolveTenantContext(empresaSlug);
  if (!tenant) notFound();

  const basePath = `/${tenant.organizationSlug}/architect`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[#0A2540] to-[#151A21] p-6 rounded-2xl border border-[#00D4B3]/20 relative overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-1">Bienvenido, Arquitecto</h1>
          <p className="text-[#94A3B8] text-sm">Revisa proyectos que requieren aprobacion de calidad en esta empresa.</p>
        </div>
        <Link href={`${basePath}/artifacts`} className="relative z-10 bg-[#00D4B3] hover:bg-[#00bda0] text-gray-900 px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-[#00D4B3]/20">
          Ir a Control de Calidad
        </Link>
      </div>
    </div>
  );
}

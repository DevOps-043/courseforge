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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[var(--engine-primary)] to-[var(--engine-surface-solid)] p-6 rounded-2xl border border-[var(--engine-accent)]/20 relative overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-1">Bienvenido, Arquitecto</h1>
          <p className="text-[var(--engine-text-muted)] text-sm">Revisa proyectos que requieren aprobacion de calidad en esta empresa.</p>
        </div>
        <Link href={`${basePath}/artifacts`} className="relative z-10 bg-[var(--engine-accent)] hover:bg-[var(--engine-accent-hover)] text-gray-900 px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-[var(--engine-accent)]/20">
          Ir a Control de Calidad
        </Link>
      </div>
    </div>
  );
}

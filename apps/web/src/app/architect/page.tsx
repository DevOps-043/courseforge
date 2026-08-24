import Link from 'next/link';

export default async function ArchitectDashboardPage() {
  return (
    <div className="space-y-6">
      <div className="engine-page-hero flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative z-10">
          <p className="engine-eyebrow">Calidad instruccional</p>
          <h1 className="mb-3">Bienvenido, arquitecto</h1>
          <p className="text-[var(--engine-text-muted)] text-sm">Aquí puedes revisar los proyectos que requieren aprobación de calidad.</p>
        </div>
        <Link href="/architect/artifacts" className="relative z-10 px-5 py-2.5 text-sm font-medium flex items-center gap-2">
          Ir a Control de Calidad
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="col-span-1 p-6 bg-white dark:bg-[var(--engine-surface-solid)] rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm flex flex-col gap-2">
           <h3 className="text-sm text-gray-500 font-semibold uppercase tracking-wider">Pendientes de Revisión</h3>
           <p className="text-3xl font-bold text-gray-900 dark:text-white">Explorar tabla</p>
           <p className="text-xs text-gray-400">Proyectos en Fase 3 listos para ti.</p>
        </div>
      </div>
    </div>
  );
}

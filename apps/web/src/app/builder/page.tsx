import Link from 'next/link';
import { Plus } from 'lucide-react';

export default async function ConstructorDashboardPage() {
  return (
    <div className="space-y-6">
      <div className="engine-page-hero flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative z-10">
          <p className="engine-eyebrow">Producción de contenidos</p>
          <h1 className="mb-3">Tu espacio de trabajo</h1>
          <p className="text-[var(--engine-text-muted)] text-sm">Organiza tu información y trabaja en los proyectos que tienes asignados.</p>
        </div>
          <Link href="/builder/artifacts/new" className="relative z-10 px-5 py-2.5 text-sm font-medium flex items-center gap-2 group">
            <Plus size={18} className="group-hover:rotate-90 transition-transform" />
            Crear Proyecto
          </Link>
        </div>
  
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="col-span-1 p-6 bg-white dark:bg-[var(--engine-surface-solid)] rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm flex flex-col gap-2">
             <h3 className="text-sm text-gray-500 font-semibold uppercase tracking-wider">Flujos Incompletos</h3>
             <p className="text-3xl font-bold text-gray-900 dark:text-white">Explorar asignaciones</p>
             <p className="text-xs text-gray-400">Continúa trabajando donde lo dejaste.</p>
             
             <Link href="/builder/artifacts" className="mt-4 text-sm text-[var(--engine-accent)] font-medium hover:underline">
               Ver todos mis proyectos →
             </Link>
        </div>
      </div>
    </div>
  );
}

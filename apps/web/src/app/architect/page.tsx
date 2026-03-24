import React from 'react';
import Link from 'next/link';

export default async function ArchitectDashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[#0A2540] to-[#151A21] p-6 rounded-2xl border border-[#00D4B3]/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#00D4B3]/10 rounded-full blur-[60px] pointer-events-none translate-x-1/2 -translate-y-1/2" />

        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-1">Bienvenido, Arquitecto</h1>
          <p className="text-[#94A3B8] text-sm">Aquí puedes revisar los proyectos que requieren aprobación de calidad.</p>
        </div>
        <Link href="/architect/artifacts" className="relative z-10 bg-[#00D4B3] hover:bg-[#00bda0] text-gray-900 px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-[#00D4B3]/20">
          Ir a Control de Calidad
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="col-span-1 p-6 bg-white dark:bg-[#151A21] rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm flex flex-col gap-2">
           <h3 className="text-sm text-gray-500 font-semibold uppercase tracking-wider">Pendientes de Revisión</h3>
           <p className="text-3xl font-bold text-gray-900 dark:text-white">Explorar tabla</p>
           <p className="text-xs text-gray-400">Proyectos en Fase 3 listos para ti.</p>
        </div>
      </div>
    </div>
  );
}

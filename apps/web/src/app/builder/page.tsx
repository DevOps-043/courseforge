import React from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';

export default async function ConstructorDashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[#0A2540] to-[#151A21] p-6 rounded-2xl border border-[#1F5AF6]/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#1F5AF6]/10 rounded-full blur-[60px] pointer-events-none translate-x-1/2 -translate-y-1/2" />

        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-1">Tu Espacio de Trabajo</h1>
          <p className="text-[#94A3B8] text-sm">Organiza tu información y trabaja en los proyectos que tienes asignados.</p>
        </div>
          <Link href="/builder/artifacts/new" className="relative z-10 bg-[#1F5AF6] hover:bg-[#1a4bd6] text-white px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-[#1F5AF6]/20 group">
            <Plus size={18} className="group-hover:rotate-90 transition-transform" />
            Crear Proyecto
          </Link>
        </div>
  
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="col-span-1 p-6 bg-white dark:bg-[#151A21] rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm flex flex-col gap-2">
             <h3 className="text-sm text-gray-500 font-semibold uppercase tracking-wider">Flujos Incompletos</h3>
             <p className="text-3xl font-bold text-gray-900 dark:text-white">Explorar asignaciones</p>
             <p className="text-xs text-gray-400">Continúa trabajando donde lo dejaste.</p>
             
             <Link href="/builder/artifacts" className="mt-4 text-sm text-[#1F5AF6] font-medium hover:underline">
               Ver todos mis proyectos →
             </Link>
        </div>
      </div>
    </div>
  );
}

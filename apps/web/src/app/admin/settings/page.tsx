import { Gauge } from 'lucide-react';
import { CurationSettingsManager } from '@/domains/curation/components/CurationSettingsManager';
import { VideoStudioSettings } from '@/domains/production/components/VideoStudioSettings';

export default function SettingsPage() {
  return (
    <div className="space-y-8 w-full animate-in fade-in zoom-in duration-500">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Configuración</h1>
        <p className="text-gray-500 dark:text-[#94A3B8]">Administración y ajustes del sistema.</p>
      </div>

      <div className="space-y-6">
        <section className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-gray-100 dark:border-[#6C757D]/10 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-500">
              <Gauge size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Configuración por Fase</h3>
              <p className="text-sm text-gray-500 dark:text-[#94A3B8]">
                Modelos, parámetros y prompts organizados por el flujo real del pipeline
              </p>
            </div>
          </div>
          <div className="p-6">
            <CurationSettingsManager />
          </div>
        </section>
        <section className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-gray-100 dark:border-[#6C757D]/10">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Estudio de video</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-[#94A3B8]">Asistente de edición y conexión segura para renderizados.</p>
          </div>
          <div className="p-6"><VideoStudioSettings /></div>
        </section>
      </div>
    </div>
  );
}

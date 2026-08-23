import { Gauge } from 'lucide-react';
import { CurationSettingsManager } from '@/domains/curation/components/CurationSettingsManager';
import { VideoStudioSettings } from '@/domains/production/components/VideoStudioSettings';

export default function SettingsPage() {
  return (
    <div className="space-y-8 w-full animate-in fade-in zoom-in duration-500">
      <div className="engine-page-hero flex items-center">
        <div>
          <p className="engine-eyebrow">Preferencias del sistema</p>
          <h1 className="mb-3">Configuración</h1>
          <p>Administra modelos, parámetros y herramientas del pipeline.</p>
        </div>
      </div>

      <div className="space-y-6">
        <section className="engine-settings-shell">
          <div className="engine-settings-intro">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-500">
              <Gauge size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Configuración por Fase</h3>
              <p className="text-sm text-gray-500 dark:text-[var(--engine-text-muted)]">
                Modelos, parámetros y prompts organizados por el flujo real del pipeline
              </p>
            </div>
          </div>
          <div className="engine-settings-manager">
            <CurationSettingsManager />
          </div>
        </section>
        <section className="engine-surface overflow-hidden">
          <div className="p-6 border-b border-gray-100 dark:border-[var(--engine-muted)]/10">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Agente de edición</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-[var(--engine-text-muted)]">Configura el modelo que prepara propuestas de edición.</p>
          </div>
          <div className="p-6"><VideoStudioSettings /></div>
        </section>
      </div>
    </div>
  );
}

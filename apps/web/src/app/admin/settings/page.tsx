import { MessageSquareCode, Gauge } from 'lucide-react';
import { SystemPromptsManager } from '@/domains/prompts/components/SystemPromptsManager';
import { CurationSettingsManager } from '@/domains/curation/components/CurationSettingsManager';

export default function SettingsPage() {
  return (
    <div className="space-y-8 w-full">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Configuración</h1>
        <p className="text-[#94A3B8]">Administración y ajustes del sistema.</p>
      </div>

      {/* Settings Sections */}
      <div className="space-y-6">
        
        {/* System Prompts Management */}
        <section className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-[#6C757D]/10 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500">
                    <MessageSquareCode size={20} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">Prompts del Sistema</h3>
                    <p className="text-sm text-[#94A3B8]">Gestiona los prompts de IA utilizados por la plataforma</p>
                </div>
            </div>
            <div className="p-6">
                <SystemPromptsManager />
            </div>
        </section>

        {/* Curation Settings */}
        <section className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-[#6C757D]/10 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                    <Gauge size={20} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">Configuración de Curaduría</h3>
                    <p className="text-sm text-[#94A3B8]">Ajustes de modelos y parámetros para el proceso de curaduría (Paso 4)</p>
                </div>
            </div>
            <div className="p-6">
                <CurationSettingsManager />
            </div>
        </section>

      </div>
    </div>
  );
}

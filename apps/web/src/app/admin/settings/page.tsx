
import { Save, Globe, Lock, Bell, Cpu } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Configuración</h1>
        <p className="text-[#94A3B8]">Ajustes generales del sistema y preferencias.</p>
      </div>

      {/* Settings Sections */}
      <div className="space-y-6">
        
        {/* General Settings */}
        <section className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-[#6C757D]/10 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#00D4B3]/10 flex items-center justify-center text-[#00D4B3]">
                    <Globe size={20} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">General</h3>
                    <p className="text-sm text-[#94A3B8]">Información básica de la plataforma</p>
                </div>
            </div>
            <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-[#94A3B8]">Nombre de la Plataforma</label>
                        <input type="text" defaultValue="CourseForge" className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-white focus:border-[#00D4B3]/50 focus:outline-none transition-colors" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-[#94A3B8]">Idioma por Defecto</label>
                        <select className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-white focus:border-[#00D4B3]/50 focus:outline-none transition-colors">
                            <option value="es">Español (ES)</option>
                            <option value="en">English (US)</option>
                        </select>
                    </div>
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium text-[#94A3B8]">URL del Sitio</label>
                    <input type="url" defaultValue="https://courseforge.app" className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-white focus:border-[#00D4B3]/50 focus:outline-none transition-colors" />
                </div>
            </div>
        </section>

        {/* AI Settings */}
        <section className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-[#6C757D]/10 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#1F5AF6]/10 flex items-center justify-center text-[#1F5AF6]">
                    <Cpu size={20} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">Inteligencia Artificial</h3>
                    <p className="text-sm text-[#94A3B8]">Configuración de modelos y generación</p>
                </div>
            </div>
            <div className="p-6 space-y-6">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-[#94A3B8]">Modelo de Generación Principal</label>
                    <select className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-white focus:border-[#00D4B3]/50 focus:outline-none transition-colors">
                        <option value="gemini-pro">Google Gemini Pro 1.5</option>
                        <option value="gpt-4" disabled>GPT-4 (Próximamente)</option>
                        <option value="claude-3" disabled>Claude 3 (Próximamente)</option>
                    </select>
                </div>
                 <div className="space-y-2">
                    <label className="text-sm font-medium text-[#94A3B8]">Creatividad (Temperatura)</label>
                    <div className="flex items-center gap-4">
                        <input type="range" min="0" max="1" step="0.1" defaultValue="0.7" className="flex-1 accent-[#00D4B3] h-2 bg-[#0F1419] rounded-lg appearance-none cursor-pointer" />
                        <span className="text-sm text-white font-mono bg-[#0F1419] px-2 py-1 rounded border border-[#6C757D]/20">0.7</span>
                    </div>
                </div>
            </div>
        </section>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4">
             <button className="px-6 py-2.5 rounded-xl border border-[#6C757D]/20 text-[#94A3B8] font-medium hover:text-white hover:bg-[#1E2329] transition-colors">
                Cancelar
            </button>
            <button className="px-6 py-2.5 rounded-xl bg-[#00D4B3] text-black font-semibold hover:bg-[#00D4B3]/90 transition-colors flex items-center gap-2 shadow-lg shadow-[#00D4B3]/10">
                <Save size={18} />
                <span>Guardar Cambios</span>
            </button>
        </div>

      </div>
    </div>
  );
}

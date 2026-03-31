'use client';

import { useState, useEffect } from 'react';
import { Zap, BrainCircuit, Loader2, Save, Search, CheckCircle2, Box, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { PremiumSelect } from '@/shared/components/PremiumSelect';
import { getModelSettingsAction, updateModelSettingsAction } from '@/app/admin/settings/actions';
import type { ModelSettingsRecord } from '@/app/admin/settings/actions';

type CurationConfig = ModelSettingsRecord;

// Tipos que ya no tienen sistema activo asociado — se omiten del render
const OBSOLETE_SETTING_TYPES = new Set(['LIA MODEL', 'LIA_MODEL', 'COMPUTER']);

const SETTING_ORDER = ['ARTIFACT_BASE', 'SYLLABUS', 'INSTRUCTIONAL_PLAN', 'CURATION', 'MATERIALS', 'SEARCH', 'DEFAULT'];

const SETTING_METADATA: Record<string, { title: string; icon: React.ReactNode; isValidation: boolean }> = {
    'ARTIFACT_BASE': {
        title: 'Generación de Base del Curso (Fase 1)',
        icon: <Zap size={16} />,
        isValidation: false
    },
    'SYLLABUS': {
        title: 'Generación de Syllabus (Fase 2)',
        icon: <BrainCircuit size={16} />,
        isValidation: false
    },
    'INSTRUCTIONAL_PLAN': {
        title: 'Plan Instruccional (Fase 3)',
        icon: <Settings2 size={16} />,
        isValidation: false
    },
    'CURATION': {
        title: 'Curaduría y Validación de Fuentes (Fase 4)',
        icon: <CheckCircle2 size={16} />,
        isValidation: true
    },
    'MATERIALS': {
        title: 'Generación de Materiales Educativos (Fase 5)',
        icon: <Box size={16} />,
        isValidation: false
    },
    'SEARCH': {
        title: 'Búsqueda y Recuperación',
        icon: <Search size={16} />,
        isValidation: false
    },
    'DEFAULT': {
        title: 'Configuración General',
        icon: <Settings2 size={16} />,
        isValidation: false
    }
};

export function CurationSettingsManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [settingsList, setSettingsList] = useState<CurationConfig[]>([]);

  useEffect(() => {
     async function loadSettings() {
         const res = await getModelSettingsAction();

         if (res.success && res.settings) {
             const filtered = res.settings.filter(s => !OBSOLETE_SETTING_TYPES.has(s.setting_type));
             filtered.sort((a, b) => {
                 const ai = SETTING_ORDER.indexOf(a.setting_type);
                 const bi = SETTING_ORDER.indexOf(b.setting_type);
                 return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
             });
             setSettingsList(filtered);
         } else {
             console.error("Error loading settings:", res.error);
             toast.error("Error al cargar la configuración de modelos");
         }
         setLoading(false);
     }
     loadSettings();
  }, []);

  const handleUpdate = <Key extends keyof CurationConfig>(
      id: number,
      key: Key,
      value: CurationConfig[Key],
  ) => {
      setSettingsList(prev => prev.map(item => 
          item.id === id ? { ...item, [key]: value } : item
      ));
  };

  const saveSettings = async () => {
      setSaving(true);
      
      const res = await updateModelSettingsAction(settingsList);

      if (!res.success) {
          toast.error(res.error || 'Error guardando algunas configuraciones');
      } else {
          toast.success('Configuraciones de modelos guardadas correctamente');
      }
      setSaving(false);
  };

  const renderConfigSection = (setting: CurationConfig) => {
      const metadata = SETTING_METADATA[setting.setting_type] || { 
          title: `Configuración de ${setting.setting_type}`, 
          icon: <Settings2 size={16} />,
          isValidation: false 
      };

      const isValidation = metadata.isValidation;

      return (
        <div key={setting.id} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-2 mb-4">
                <div className={`p-2 rounded-lg ${isValidation ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#00D4B3]/10 text-[#00D4B3]'}`}>
                    {metadata.icon}
                </div>
                <h4 className="text-sm font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">{metadata.title}</h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                <PremiumSelect 
                    label="Modelo Principal"
                    icon={<Zap size={12} className={isValidation ? "text-[#10B981]" : "text-[#00D4B3]"} />}
                    value={setting.model_name ?? ''}
                    onChange={(val) => handleUpdate(setting.id, 'model_name', val)}
                    options={[
                        // Gemini 3.x Series (actual)
                        { value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', description: 'Ultra Reasoning' },
                        { value: 'gemini-3-flash', label: 'Gemini 3 Flash', description: 'Alta Velocidad' },
                        { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', description: 'Ultra Eficiente' },

                        // Gemini 2.5 Series (estable)
                        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Razonamiento Avanzado' },
                        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Balance Costo/Velocidad' },
                        { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', description: 'Alta Escala / Económico' },
                    ]}
                />
                <PremiumSelect 
                    label="Modelo Fallback"
                    icon={<span className="w-3 h-3 rounded-full border border-gray-400 dark:border-[#6C757D] flex items-center justify-center text-[8px] text-gray-400 dark:text-[#6C757D]">?</span>}
                    value={setting.fallback_model ?? ''}
                    onChange={(val) => handleUpdate(setting.id, 'fallback_model', val)}
                    options={[
                        // Gemini 3.x Series (actual)
                        { value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', description: 'Ultra Reasoning' },
                        { value: 'gemini-3-flash', label: 'Gemini 3 Flash', description: 'Alta Velocidad' },
                        { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', description: 'Ultra Eficiente' },

                        // Gemini 2.5 Series (estable)
                        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Razonamiento Avanzado' },
                        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Balance Costo/Velocidad' },
                        { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', description: 'Alta Escala / Económico' },
                    ]}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-0">
                <PremiumSelect 
                    label="Nivel de Pensamiento"
                    icon={<BrainCircuit size={12} className="text-[#1F5AF6]" />}
                    value={setting.thinking_level ?? 'medium'}
                    onChange={(val) => handleUpdate(setting.id, 'thinking_level', val)}
                    options={[
                        { value: 'minimal', label: 'Minimal', description: 'Rápido' },
                        { value: 'low', label: 'Low', description: 'Balanceado' },
                        { value: 'medium', label: 'Medium', description: 'Analítico' },
                        { value: 'high', label: 'High', description: 'Profundo' }
                    ]}
                />

                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">Temperatura (Creatividad)</label>
                        <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${isValidation ? 'text-[#10B981] bg-[#10B981]/10 border-[#10B981]/20' : 'text-[#00D4B3] bg-[#00D4B3]/10 border-[#00D4B3]/20'}`}>
                            {setting.temperature}
                        </span>
                    </div>
                    <div className="relative pt-2">
                        <input 
                            type="range" 
                            min="0.1" 
                            max="1.0" 
                            step="0.1"
                            value={setting.temperature ?? 0.7}
                            onChange={(e) => handleUpdate(setting.id, 'temperature', parseFloat(e.target.value))}
                            className={`w-full h-2 bg-gray-200 dark:bg-[#0A0D12] rounded-lg appearance-none cursor-pointer hover:opacity-100 relative z-20 ${isValidation ? 'accent-[#10B981]' : 'accent-[#00D4B3]'}`}
                        />
                        <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-300 dark:bg-[#1E2329] -translate-y-1/2 z-0" />
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-400 dark:text-[#6C757D]">
                        <span>Preciso (0.1)</span>
                        <span>Creativo (1.0)</span>
                    </div>
                </div>
            </div>
            
            {/* Divider between items, but not after the last one */}
            {settingsList.indexOf(setting) < settingsList.length - 1 && (
                <div className="h-px bg-gray-100 dark:bg-[#6C757D]/10 mt-8 mb-8" />
            )}
        </div>
      );
  };

  if (loading) return <div className="p-8 flex justify-center text-[#00D4B3]"><Loader2 className="animate-spin" /></div>;

  if (settingsList.length === 0) {
      return (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
              <Settings2 className="mx-auto mb-4 opacity-50" size={48} />
              <p>No se encontraron configuraciones de modelos activas.</p>
          </div>
      );
  }

  return (
    <div className="space-y-12">
       {settingsList.map(setting => renderConfigSection(setting))}

       <div className="pt-4 flex justify-end border-t border-gray-100 dark:border-[#6C757D]/10 mt-6">
          <button 
             onClick={saveSettings}
             disabled={saving}
             className="px-6 py-2.5 bg-[#0A2540] text-white hover:bg-[#0A2540]/90 dark:bg-[#00D4B3] dark:text-[#0A0D12] text-sm font-bold rounded-xl dark:hover:bg-[#00bda0] disabled:opacity-50 transition-all flex items-center gap-2 shadow-lg shadow-[#0A2540]/20 dark:shadow-[#00D4B3]/20"
          >
             {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
             Guardar Configuración
          </button>
       </div>
    </div>
  );
}


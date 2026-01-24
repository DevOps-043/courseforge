'use client';

import { useState, useEffect } from 'react';
import { Zap, BrainCircuit, Loader2, Save, Search, CheckCircle2, Box, Settings2, FileText, Monitor } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { toast } from 'sonner';
import { PremiumSelect } from '@/shared/components/PremiumSelect';

interface CurationConfig {
    id: number;
    model_name: string;
    fallback_model: string;
    temperature: number;
    thinking_level: string;
    setting_type: string;
    is_active: boolean;
}

const SETTING_METADATA: Record<string, { title: string; icon: React.ReactNode; isValidation: boolean }> = {
    'CURATION': {
        title: 'Modelos de Curaduría y Validación',
        icon: <CheckCircle2 size={16} />,
        isValidation: true
    },
    'MATERIALS': {
        title: 'Generación de Materiales Educativos',
        icon: <Box size={16} />,
        isValidation: false
    },
    'SEARCH': {
        title: 'Búsqueda y Recuperación',
        icon: <Search size={16} />,
        isValidation: false
    },
    'LIA MODEL': {
        title: 'Modelo de Razonamiento (Lia)',
        icon: <BrainCircuit size={16} />,
        isValidation: false
    },
    'COMPUTER': {
        title: 'Uso de Computadora (Lia Visual)',
        icon: <Monitor size={16} />,
        isValidation: false
    },
    'DEFAULT': {
        title: 'Configuración General',
        icon: <Settings2 size={16} />,
        isValidation: false
    }
};

export function CurationSettingsManager() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [settingsList, setSettingsList] = useState<CurationConfig[]>([]);

  useEffect(() => {
     async function loadSettings() {
         const { data, error } = await supabase
            .from('model_settings')
            .select('*')
            .eq('is_active', true)
            .order('id', { ascending: true });
         
         if (data) {
             setSettingsList(data);
         } else if (error) {
             console.error("Error loading settings:", error);
             toast.error("Error al cargar la configuración");
         }
         setLoading(false);
     }
     loadSettings();
  }, []);

  const handleUpdate = (id: number, key: keyof CurationConfig, value: any) => {
      setSettingsList(prev => prev.map(item => 
          item.id === id ? { ...item, [key]: value } : item
      ));
  };

  const saveSettings = async () => {
      setSaving(true);
      
      const updates = settingsList.map(setting => 
          supabase.from('model_settings').update({
              model_name: setting.model_name,
              fallback_model: setting.fallback_model,
              temperature: setting.temperature,
              thinking_level: setting.thinking_level
          }).eq('id', setting.id)
      );

      const results = await Promise.all(updates);
      const errors = results.filter(r => r.error);

      if (errors.length > 0) {
          console.error('Save errors:', errors);
          toast.error('Error guardando algunas configuraciones');
      } else {
          toast.success('Configuraciones guardadas correctamente');
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
                    value={setting.model_name}
                    onChange={(val) => handleUpdate(setting.id, 'model_name', val)}
                    options={[
                        // Gemini 3.0 Series (Preview)
                        { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', description: 'Next Gen Preview' },
                        { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', description: 'High Speed Preview' },

                        // Gemini 2.0 Series (Experimental)
                        { value: 'gemini-2.0-pro-exp', label: 'Gemini 2.0 Pro Exp', description: 'SOTA Experimental' },
                        { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash Exp', description: 'Fast Experimental' },
                        
                        // Gemini 1.5 Series (Stable)
                        { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', description: 'Complex Reasoning' },
                        { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'High Efficiency' },
                        { value: 'gemini-1.0-pro', label: 'Gemini 1.0 Pro', description: 'Legacy Standard' }
                    ]}
                />
                <PremiumSelect 
                    label="Modelo Fallback"
                    icon={<span className="w-3 h-3 rounded-full border border-gray-400 dark:border-[#6C757D] flex items-center justify-center text-[8px] text-gray-400 dark:text-[#6C757D]">?</span>}
                    value={setting.fallback_model}
                    onChange={(val) => handleUpdate(setting.id, 'fallback_model', val)}
                    options={[
                        // Gemini 3.0 Series (Preview)
                        { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', description: 'Next Gen Preview' },
                        { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', description: 'High Speed Preview' },

                        // Gemini 2.0 Series (Experimental)
                        { value: 'gemini-2.0-pro-exp', label: 'Gemini 2.0 Pro Exp', description: 'SOTA Experimental' },
                        { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash Exp', description: 'Fast Experimental' },
                        
                        // Gemini 1.5 Series (Stable)
                        { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', description: 'Complex Reasoning' },
                        { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'High Efficiency' },
                        { value: 'gemini-1.0-pro', label: 'Gemini 1.0 Pro', description: 'Legacy Standard' }
                    ]}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-0">
                <PremiumSelect 
                    label="Nivel de Pensamiento"
                    icon={<BrainCircuit size={12} className="text-[#1F5AF6]" />}
                    value={setting.thinking_level}
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
                            value={setting.temperature}
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


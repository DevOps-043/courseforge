'use client';

import { useState, useEffect } from 'react';
import { Zap, BrainCircuit, Loader2, Save, Search, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { toast } from 'sonner';
import { PremiumSelect } from '@/shared/components/PremiumSelect';

interface CurationConfig {
    model_name: string;
    fallback_model: string;
    temperature: number;
    thinking_level: string;
}

export function CurationSettingsManager() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [searchSettings, setSearchSettings] = useState<CurationConfig>({
      model_name: 'gemini-2.5-flash',
      fallback_model: 'gemini-2.0-flash',
      temperature: 1.0,
      thinking_level: 'high'
  });

  const [validationSettings, setValidationSettings] = useState<CurationConfig>({
      model_name: '3-pro-review',
      fallback_model: '3-flash-review',
      temperature: 0.3,
      thinking_level: 'high'
  });

  useEffect(() => {
     async function loadSettings() {
         const { data, error } = await supabase.from('curation_settings').select('*').in('id', [1, 2]);
         
         if (data) {
             const searchConfig = data.find(c => c.id === 1);
             const validationConfig = data.find(c => c.id === 2);

             if (searchConfig) {
                 setSearchSettings({
                     model_name: searchConfig.model_name || 'gemini-2.5-flash',
                     fallback_model: searchConfig.fallback_model || 'gemini-2.0-flash',
                     temperature: searchConfig.temperature ?? 1.0,
                     thinking_level: searchConfig.thinking_level || 'high'
                 });
             }

             if (validationConfig) {
                 setValidationSettings({
                     model_name: validationConfig.model_name || '3-pro-review',
                     fallback_model: validationConfig.fallback_model || '3-flash-review',
                     temperature: validationConfig.temperature ?? 0.3,
                     thinking_level: validationConfig.thinking_level || 'high'
                 });
             }
         }
         setLoading(false);
     }
     loadSettings();
  }, []);

  const handleSearchUpdate = (key: keyof CurationConfig, value: any) => {
      setSearchSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleValidationUpdate = (key: keyof CurationConfig, value: any) => {
      setValidationSettings(prev => ({ ...prev, [key]: value }));
  };

  const saveSettings = async () => {
      setSaving(true);
      
      const updates = [
          supabase.from('curation_settings').update(searchSettings).eq('id', 1),
          supabase.from('curation_settings').update(validationSettings).eq('id', 2)
      ];

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

  const renderConfigSection = (
      title: string, 
      icon: React.ReactNode, 
      settings: CurationConfig, 
      onUpdate: (key: keyof CurationConfig, val: any) => void,
      isValidation: boolean = false
    ) => (
      <div className="space-y-6">
          <div className="flex items-center gap-2 mb-4">
              <div className={`p-2 rounded-lg ${isValidation ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#00D4B3]/10 text-[#00D4B3]'}`}>
                  {icon}
              </div>
              <h4 className="text-sm font-bold text-gray-300 uppercase tracking-wider">{title}</h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
               <PremiumSelect 
                  label="Modelo Principal"
                  icon={<Zap size={12} className={isValidation ? "text-[#10B981]" : "text-[#00D4B3]"} />}
                  value={settings.model_name}
                  onChange={(val) => onUpdate('model_name', val)}
                  options={[
                      // Custom / Future Models (Most Recent "3")
                      { value: '3-pro-review', label: 'Gemini 3 Pro Review', description: 'Custom Validator' },
                      { value: '3-flash-review', label: 'Gemini 3 Flash Review', description: 'Custom Fallback' },
                      
                      // Gemini 2.5 Series
                      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Próxima Gen (Preview)' },
                      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Velocidad Extrema' },

                      // Gemini 2.0 Series
                      { value: 'gemini-2.0-pro-exp', label: 'Gemini 2.0 Pro Exp', description: 'SOTA Experimental' },
                      { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash', description: 'Estándar Actual' },
                      
                      // Gemini 1.5 Series
                      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', description: 'Nivel Humano' },
                      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'Alta Eficiencia' },
                      { value: 'gemini-1.0-pro', label: 'Gemini 1.0 Pro', description: 'Legacy' }
                  ]}
               />
               <PremiumSelect 
                  label="Modelo Fallback"
                  icon={<span className="w-3 h-3 rounded-full border border-[#6C757D] flex items-center justify-center text-[8px] text-[#6C757D]">?</span>}
                  value={settings.fallback_model}
                  onChange={(val) => onUpdate('fallback_model', val)}
                  options={[
                      // Custom / Future Models (Most Recent "3")
                      { value: '3-pro-review', label: 'Gemini 3 Pro Review', description: 'Custom Validator' },
                      { value: '3-flash-review', label: 'Gemini 3 Flash Review', description: 'Custom Fallback' },
                      
                      // Gemini 2.5 Series
                      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Próxima Gen (Preview)' },
                      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Velocidad Extrema' },

                      // Gemini 2.0 Series
                      { value: 'gemini-2.0-pro-exp', label: 'Gemini 2.0 Pro Exp', description: 'SOTA Experimental' },
                      { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash', description: 'Estándar Actual' },
                      
                      // Gemini 1.5 Series
                      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', description: 'Nivel Humano' },
                      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'Alta Eficiencia' },
                      { value: 'gemini-1.0-pro', label: 'Gemini 1.0 Pro', description: 'Legacy' }
                  ]}
               />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-0">
               <PremiumSelect 
                  label="Nivel de Pensamiento"
                  icon={<BrainCircuit size={12} className="text-[#1F5AF6]" />}
                  value={settings.thinking_level}
                  onChange={(val) => onUpdate('thinking_level', val)}
                  options={[
                      { value: 'minimal', label: 'Minimal', description: 'Rápido' },
                      { value: 'low', label: 'Low', description: 'Balanceado' },
                      { value: 'medium', label: 'Medium', description: 'Analítico' },
                      { value: 'high', label: 'High', description: 'Profundo' }
                  ]}
               />

               <div className="space-y-4">
                   <div className="flex justify-between items-center">
                       <label className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-wider">Temperatura (Creatividad)</label>
                       <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${isValidation ? 'text-[#10B981] bg-[#10B981]/10 border-[#10B981]/20' : 'text-[#00D4B3] bg-[#00D4B3]/10 border-[#00D4B3]/20'}`}>
                           {settings.temperature}
                       </span>
                   </div>
                   <div className="relative pt-2">
                       <input 
                          type="range" 
                          min="0.1" 
                          max="1.0" 
                          step="0.1"
                          value={settings.temperature}
                          onChange={(e) => onUpdate('temperature', parseFloat(e.target.value))}
                          className={`w-full h-2 bg-[#0A0D12] rounded-lg appearance-none cursor-pointer hover:opacity-100 relative z-20 ${isValidation ? 'accent-[#10B981]' : 'accent-[#00D4B3]'}`}
                       />
                       <div className="absolute top-1/2 left-0 right-0 h-px bg-[#1E2329] -translate-y-1/2 z-0" />
                   </div>
                   <div className="flex justify-between text-[10px] text-[#6C757D]">
                       <span>Preciso (0.1)</span>
                       <span>Creativo (1.0)</span>
                   </div>
               </div>
          </div>
      </div>
  );

  if (loading) return <div className="p-8 flex justify-center text-[#00D4B3]"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-12">
       {/* Section 1: Search Models */}
       {renderConfigSection(
           "Modelos de Búsqueda y Recuperación", 
           <Search size={16} />, 
           searchSettings, 
           handleSearchUpdate,
           false
       )}

       {/* Divider */}
       <div className="h-px bg-[#6C757D]/10" />

       {/* Section 2: Validation Models */}
       {renderConfigSection(
           "Modelos de Validación y Evaluación", 
           <CheckCircle2 size={16} />, 
           validationSettings, 
           handleValidationUpdate,
           true
       )}

       <div className="pt-4 flex justify-end border-t border-[#6C757D]/10 mt-6">
          <button 
             onClick={saveSettings}
             disabled={saving}
             className="px-6 py-2.5 bg-[#00D4B3] text-[#0A0D12] text-sm font-bold rounded-xl hover:bg-[#00bda0] disabled:opacity-50 transition-all flex items-center gap-2 shadow-lg shadow-[#00D4B3]/20"
          >
             {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
             Guardar Configuración
          </button>
       </div>
    </div>
  );
}


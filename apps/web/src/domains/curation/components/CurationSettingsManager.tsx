'use client';

import { useState, useEffect } from 'react';
import { Gauge, Zap, BrainCircuit, Loader2, Save } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { toast } from 'sonner';
import { PremiumSelect } from '@/shared/components/PremiumSelect';

export function CurationSettingsManager() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
      model_name: 'gemini-2.0-flash',
      fallback_model: 'gemini-2.0-flash',
      temperature: 0.1,
      thinking_level: 'minimal'
  });

  useEffect(() => {
     async function loadSettings() {
         const { data } = await supabase.from('curation_settings').select('*').eq('id', 1).single();
         if (data) {
             setSettings({
                 model_name: data.model_name || 'gemini-2.0-flash',
                 fallback_model: data.fallback_model || 'gemini-2.0-flash',
                 temperature: data.temperature || 0.1,
                 thinking_level: data.thinking_level || 'minimal'
             });
         }
         setLoading(false);
     }
     loadSettings();
  }, []);

  const handleUpdate = (key: string, value: any) => {
      console.log(`Changing ${key} to:`, value); // Debug log
      setSettings(prev => ({ ...prev, [key]: value }));
  };

  const saveSettings = async () => {
      setSaving(true);
      
      console.log('Attempting to save:', settings); // Debug log

      const { data, error } = await supabase
        .from('curation_settings')
        .update(settings)
        .eq('id', 1)
        .select(); // Select to verify update returned data

      if (error) {
          console.error('Save error:', error);
          toast.error('Error guardando configuración');
      } else {
          console.log('Save success, data:', data);
          if (data && data.length > 0) {
             toast.success('Configuración guardada correctamente');
          } else {
             toast.error('No se pudo guardar (posible error de permisos)');
          }
      }
      setSaving(false);
  };

  if (loading) return <div className="p-8 flex justify-center text-[#00D4B3]"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-6">
       {/* Row 1: Models */}
       <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-20">
           <PremiumSelect 
              label="Modelo Principal"
              icon={<Zap size={12} className="text-[#00D4B3]" />}
              value={settings.model_name}
              onChange={(val) => handleUpdate('model_name', val)}
              options={[
                  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Potente' },
                  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Rápido' },
                  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', description: 'Ligero' },
                  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Estándar' }
              ]}
           />
           <PremiumSelect 
              label="Modelo Fallback"
              icon={<span className="w-3 h-3 rounded-full border border-[#6C757D] flex items-center justify-center text-[8px] text-[#6C757D]">?</span>}
              value={settings.fallback_model}
              onChange={(val) => handleUpdate('fallback_model', val)}
              options={[
                  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Recomendado' },
                  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Veloz' },
                  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', description: 'Eficiente' }
              ]}
           />
       </div>

       {/* Row 2: Parameters */}
       <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
            <PremiumSelect 
              label="Nivel de Pensamiento"
              icon={<BrainCircuit size={12} className="text-[#1F5AF6]" />}
              value={settings.thinking_level}
              onChange={(val) => handleUpdate('thinking_level', val)}
              options={[
                  { value: 'minimal', label: 'Minimal', description: 'Rápido' },
                  { value: 'low', label: 'Low', description: 'Balanceado' },
                  { value: 'medium', label: 'Medium', description: 'Analítico' },
                  { value: 'high', label: 'High', description: 'Profundo' }
              ]}
           />

           {/* Temperature Slider */}
           <div className="space-y-4">
               <div className="flex justify-between items-center">
                   <label className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-wider">Temperatura (Creatividad)</label>
                   <span className="text-xs font-mono font-bold text-[#00D4B3] bg-[#00D4B3]/10 px-2 py-0.5 rounded border border-[#00D4B3]/20">
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
                      onChange={(e) => handleUpdate('temperature', parseFloat(e.target.value))}
                      className="w-full h-2 bg-[#0A0D12] rounded-lg appearance-none cursor-pointer accent-[#00D4B3] hover:accent-[#00bda0] relative z-20"
                   />
                   {/* Track decoration */}
                   <div className="absolute top-1/2 left-0 right-0 h-px bg-[#1E2329] -translate-y-1/2 z-0" />
               </div>
               <div className="flex justify-between text-[10px] text-[#6C757D]">
                   <span>Preciso (0.1)</span>
                   <span>Creativo (1.0)</span>
               </div>
           </div>
       </div>

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

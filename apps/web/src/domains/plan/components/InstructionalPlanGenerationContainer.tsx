
import { useState } from 'react';
import { BookOpen, Sparkles, Settings2, Play, Edit3 } from 'lucide-react';

interface InstructionalPlanGenerationContainerProps {
  artifactId: string;
}

const DEFAULT_PROMPT_PREVIEW = `Genera un plan instruccional detallado para cada lección del temario proporcionado.
Para cada lección, debes estructurar el contenido en 4 componentes obligatorios:
1. DIALOGUE: Guion conversacional o explicativo.
2. READING: Material de lectura complementario.
3. QUIZ: Pregunta de evaluación.
4. VIDEO: Sugerencia visual o script.
...`;

export function InstructionalPlanGenerationContainer({ artifactId }: InstructionalPlanGenerationContainerProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Custom Prompt States
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');

  const handleGenerate = () => {
    setIsGenerating(true);
    // TODO: Usar customPrompt si useCustomPrompt es true y no está vacío
    setTimeout(() => setIsGenerating(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      
      {/* Header Minimalista */}
      <div className="space-y-2">
         <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#1F5AF6]/10 text-[#1F5AF6]">
                <BookOpen size={24} />
            </div>
            Paso 3: Plan Instruccional
         </h2>
         <p className="text-[#94A3B8] text-base leading-relaxed max-w-2xl ml-12">
            La IA generará el plan instruccional detallado para cada lección, definiendo actividades, recursos y evaluaciones validadas pedagógicamente.
         </p>
      </div>

      {/* Card de Configuración Sutil */}
      <div className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl p-6 shadow-xl shadow-black/20 transition-all duration-300">
          <div className="flex justify-between items-center mb-6">
              <h3 className="text-white font-semibold text-sm uppercase tracking-wider flex items-center gap-2">
                  <Settings2 size={16} className="text-[#00D4B3]" />
                  Configuración de Generación
              </h3>
              <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium transition-colors ${useCustomPrompt ? 'text-[#00D4B3]' : 'text-[#6C757D]'}`}>
                      {useCustomPrompt ? 'Prompt Personalizado Activo' : 'Prompt Personalizado'}
                  </span>
                  
                  {/* Functional Toggle Switch */}
                  <button 
                      onClick={() => setUseCustomPrompt(!useCustomPrompt)}
                      className={`w-10 h-5 rounded-full relative border transition-all duration-300 focus:outline-none ${useCustomPrompt ? 'bg-[#00D4B3]/20 border-[#00D4B3]' : 'bg-[#0F1419] border-[#6C757D]/20'}`}
                  >
                      <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 shadow-sm ${useCustomPrompt ? 'left-5 bg-[#00D4B3]' : 'left-0.5 bg-[#6C757D]'}`} />
                  </button>
              </div>
          </div>

          {/* Prompt Section: Inline Switching */}
          <div className="relative">
              {useCustomPrompt ? (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-3">
                      <div className="flex justify-between items-center">
                          <label className="text-xs text-gray-400 font-medium">Instrucciones del Sistema para la IA</label>
                          <span className="text-[10px] text-[#00D4B3] bg-[#00D4B3]/10 px-2 py-0.5 rounded border border-[#00D4B3]/20">Modo Edición</span>
                      </div>
                      <textarea 
                          value={customPrompt}
                          onChange={(e) => setCustomPrompt(e.target.value)}
                          className="w-full h-48 bg-[#0F1419] border border-[#00D4B3]/30 rounded-xl p-4 text-sm text-gray-300 font-mono leading-relaxed focus:outline-none focus:border-[#00D4B3] transition-colors resize-none shadow-inner placeholder:text-gray-600"
                          placeholder={DEFAULT_PROMPT_PREVIEW}
                      />
                      <p className="text-xs text-gray-500">
                        <span className="text-[#00D4B3]">*</span> Asegúrate de solicitar una respuesta en formato JSON estrictamente válido.
                      </p>
                  </div>
              ) : (
                  <div className="bg-[#0F1419] border border-[#6C757D]/10 rounded-xl p-4 flex items-center gap-4 group hover:border-[#00D4B3]/20 transition-colors cursor-default animate-in fade-in duration-300">
                      <div className="w-10 h-10 rounded-full bg-[#00D4B3]/10 flex items-center justify-center shrink-0">
                           <Sparkles size={18} className="text-[#00D4B3]" />
                      </div>
                      <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                              <h4 className="text-gray-200 font-medium text-sm">Modelo Estándar Optimizado</h4>
                              <span className="px-2 py-0.5 rounded text-[10px] bg-[#00D4B3]/10 text-[#00D4B3] border border-[#00D4B3]/20 font-mono">v2.0</span>
                          </div>
                          <p className="text-[#6C757D] text-xs truncate">
                              Incluye validación Bloom, componentes obligatorios (Diálogo, Quiz, Video) y estructura JSON.
                          </p>
                      </div>
                  </div>
              )}
          </div>
      </div>

      {/* Botón de Acción Principal */}
      <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className={`
              w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all relative overflow-hidden
              ${isGenerating 
                  ? 'bg-[#00D4B3]/20 text-[#00D4B3] cursor-wait border border-[#00D4B3]/20' 
                  : 'bg-[#00D4B3] hover:bg-[#00bda0] text-[#0A2540] shadow-lg shadow-[#00D4B3]/25 hover:shadow-[#00D4B3]/40 hover:-translate-y-0.5'}
          `}
      >
          {isGenerating ? (
              <>
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span>Generando Estructura Instruccional...</span>
              </>
          ) : (
              <>
                  <Play size={20} fill="currentColor" />
                  Generar Plan Instruccional
              </>
          )}
      </button>

      {/* Nota al pie sutil */}
      <div className="text-center">
          <p className="text-[#6C757D] text-xs">
              La generación puede tomar entre 5 a 10 minutos dependiendo del número de módulos.
          </p>
      </div>

    </div>
  );
}

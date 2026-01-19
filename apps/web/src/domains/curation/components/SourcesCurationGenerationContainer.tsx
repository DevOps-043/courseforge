import { useState, useEffect } from 'react';
import { BookOpen, Settings2, CheckCircle2, Play, RefreshCw, Library, Loader2 } from 'lucide-react';
import { useCuration } from '../hooks/useCuration';
import { CurationDashboard } from './CurationDashboard';
import { motion } from 'framer-motion';


interface SourcesCurationGenerationContainerProps {
  artifactId: string;
}

const DEFAULT_PROMPT_PREVIEW = `Prompt optimizado con reglas de curaduría, enfoque en accesibilidad (sin descargas), validación de URLs y estructura JSON estricta. Utiliza búsquedas en tiempo real para verificar la disponibilidad.`;

export function SourcesCurationGenerationContainer({ artifactId }: SourcesCurationGenerationContainerProps) {
  const { curation, rows, isGenerating, startCuration, updateRow, refresh } = useCuration(artifactId);
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  

  
  // Dynamic Progress Calculation based on real data
  // Heuristic: Each row found adds to progress. Capped at 98% until 'isGenerating' becomes false.
  // Assuming average course has ~30-50 components. We'll map 50 components to 100%.
  const [progress, setProgress] = useState(5);
  
  useEffect(() => {
     // If process finished significantly, jump to 100%
     if (!isGenerating && rows.length > 0) {
        setProgress(100);
        return;
     }
     
     if (rows.length > 0) {
         // Adjusted divisor to 80 to prevent premature 98% on large courses
         const calculated = Math.min(Math.round((rows.length / 80) * 100), 95);
         setProgress(prev => Math.max(prev, calculated)); 
     }
  }, [rows.length, isGenerating]);

  // Logic to determine view state
  const hasRows = rows.length > 0;
  
  const showGeneratingView = isGenerating; 
  const showDashboard = !isGenerating && hasRows;

  const handleGenerate = async () => {
    setProgress(5); // Reset progress on new run
    await startCuration(1, []); 
  };

  // --- VIEW 1: GENERATING PROGRESS ---
  if (showGeneratingView) {
      return (
        <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in duration-700">
             <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[#0A2540] border border-[#00D4B3]/20 text-[#00D4B3]">
                        <BookOpen size={24} />
                    </div>
                    Paso 4: Curaduría de Fuentes (Fase 2)
                </h2>
             </div>

             {/* Background changed to #0F1419 to blend with Admin Panel */}
             <div className="relative overflow-hidden rounded-3xl border border-[#1E2329] bg-[#0F1419] shadow-2xl p-12 min-h-[500px] flex flex-col items-center justify-center group ring-1 ring-[#00D4B3]/10">
                  
                  {/* Subtle Background Effects */}
                  <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5 mix-blend-overlay" />
                  <div className="absolute top-[-50%] left-[-20%] w-[800px] h-[800px] bg-[#00D4B3]/5 rounded-full blur-[120px] animate-pulse-slow opacity-30" />
                  
                  <div className="relative z-10 flex flex-col items-center max-w-xl w-full text-center space-y-12">
                      
                      {/* Central Animated Illustration - NO RINGS, ONLY DOTS */}
                      <div className="relative w-32 h-32 flex items-center justify-center">
                          
                          {/* Orbiting Dots - Tracks hidden, only dots visible */}
                          <div className="absolute inset-0 animate-[spin_4s_linear_infinite]">
                              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 bg-[#00D4B3] rounded-full shadow-[0_0_8px_#00D4B3]" />
                          </div>
                          <div className="absolute inset-4 animate-[spin_6s_linear_infinite_reverse]">
                              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 w-1.5 h-1.5 bg-[#1F5AF6] rounded-full" />
                          </div>

                          {/* Core Icon */}
                          <div className="relative w-16 h-16 bg-[#151A21] border border-[#1E2329] rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(0,212,179,0.05)] z-10">
                              <Library size={28} className="text-[#00D4B3]" />
                          </div>
                      </div>

                      {/* Text Content */}
                      <div className="space-y-4">
                          <h3 className="text-3xl font-bold text-white tracking-tight">
                             Buscando Fuentes
                          </h3>
                          <div className="flex flex-col gap-2">
                             <p className="text-[#94A3B8] text-base leading-relaxed max-w-sm mx-auto font-light">
                                Navegando la web en tiempo real, validando accesibilidad y curando el mejor contenido para tu curso.
                             </p>
                             {rows.length > 0 && (
                                <span className="text-xs font-mono text-[#00D4B3] bg-[#00D4B3]/10 px-2 py-1 rounded-md mx-auto border border-[#00D4B3]/20">
                                    {rows.length} fuentes encontradas hasta ahora
                                </span>
                             )}
                          </div>
                      </div>

                      {/* Dynamic Progress Bar */}
                      <div className="w-full max-w-md space-y-3">
                          <div className="flex justify-between items-end px-1">
                              <span className="text-[10px] font-bold tracking-widest uppercase text-[#6C757D]">Estado del Agente</span>
                              <span className="text-xs font-mono font-medium text-[#00D4B3] flex items-center gap-2">
                                 {progress < 30 ? 'Iniciando...' : progress < 60 ? 'Analizando...' : 'Finalizando...'} 
                                 <span className="opacity-80">| {progress}%</span>
                              </span>
                          </div>
                          <div className="h-2 w-full bg-[#151A21] rounded-full overflow-hidden border border-[#1E2329] p-[1px]">
                              <motion.div 
                                 className="h-full rounded-full bg-gradient-to-r from-[#00D4B3] to-[#10B981] shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                                 initial={{ width: "0%" }}
                                 animate={{ width: `${progress}%` }}
                                 transition={{ type: "spring", stiffness: 50, damping: 20 }}
                              />
                          </div>
                      </div>
                      
                      {/* Footer Info & Refresh Button */}
                      <div className="flex flex-col gap-6 items-center w-full max-w-xs">
                          <div className="flex items-center gap-2 px-4 py-2 bg-[#151A21]/80 rounded-full border border-[#00D4B3]/20 backdrop-blur-sm">
                              <Loader2 size={12} className="text-[#00D4B3] animate-spin" />
                              <span className="text-[10px] text-[#00D4B3] font-medium tracking-wide uppercase">
                                  Auto-Refresh Activo
                              </span>
                          </div>
                          
                          <button 
                             onClick={() => refresh()}
                             className="w-full py-3 px-4 rounded-xl border border-[#6C757D]/30 text-[#94A3B8] hover:text-white hover:border-[#00D4B3] hover:bg-[#00D4B3]/5 transition-all duration-300 flex items-center justify-center gap-2 group"
                          >
                             <RefreshCw size={14} className="group-hover:rotate-180 transition-transform duration-500" />
                             <span className="text-xs font-medium uppercase tracking-wide">Actualizar Progreso Manualmente</span>
                          </button>
                      </div>

                  </div>
             </div>
        </div>
      );
  }

  // --- VIEW 2: DASHBOARD (SOFIA Dark Theme) ---
  if (showDashboard) {
      return (
        <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in duration-500">
             <div className="space-y-2 flex justify-between items-start">
                 <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[#0A0D12] border border-[#1E2329] text-[#00D4B3]">
                            <BookOpen size={24} />
                        </div>
                        Paso 4: Curaduría de Fuentes (Fase 2)
                    </h2>
                    <p className="text-[#6C757D] text-base ml-12">
                        Fuentes generadas y validadas. Revise los ítems críticos.
                    </p>
                 </div>
                 <div className="flex items-center gap-2">
                    <button 
                       onClick={() => handleGenerate()}
                       className="px-3 py-1.5 rounded-lg border border-[#1E2329] text-[#6C757D] text-xs hover:border-[#6C757D] hover:text-white hover:bg-[#1E2329] transition-colors flex items-center gap-2"
                    >
                        <RefreshCw size={14} />
                        Reiniciar este paso
                    </button>
                 </div>
             </div>

             <CurationDashboard 
                rows={rows} 
                onUpdateRow={updateRow} 
                isGenerating={isGenerating} 
             />
        </div>
      );
  }

  // --- VIEW 3: INITIAL CONFIG (Matches Image 1/Previous) ---
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      <div className="space-y-2">
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#1F5AF6]/10 text-[#1F5AF6]">
                    <BookOpen size={24} />
                </div>
                Paso 4: Curaduría de Fuentes (Fase 2)
            </h2>
            <p className="text-[#94A3B8] text-base leading-relaxed max-w-2xl ml-12">
                Genera y evalúa fuentes para cada componente del plan instruccional. Incluye validación automática de disponibilidad.
            </p>
      </div>

      {/* Configuration Card */}
      <div className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl p-6 shadow-xl shadow-black/20 transition-all duration-300">
          <div className="flex justify-between items-center mb-6">
              <h3 className="text-white font-semibold text-sm uppercase tracking-wider flex items-center gap-2">
                  <Settings2 size={16} className="text-[#00D4B3]" />
                  Configuración del Prompt
              </h3>
              <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium transition-colors ${useCustomPrompt ? 'text-[#00D4B3]' : 'text-[#6C757D]'}`}>
                      {useCustomPrompt ? 'Prompt personalizado' : 'Sistema por defecto'}
                  </span>
                  
                  <button 
                      onClick={() => setUseCustomPrompt(!useCustomPrompt)}
                      className={`w-10 h-5 rounded-full relative border transition-all duration-300 focus:outline-none ${useCustomPrompt ? 'bg-[#00D4B3]/20 border-[#00D4B3]' : 'bg-[#0F1419] border-[#6C757D]/20'}`}
                  >
                      <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 shadow-sm ${useCustomPrompt ? 'left-5 bg-[#00D4B3]' : 'left-0.5 bg-[#6C757D]'}`} />
                  </button>
              </div>
          </div>

          <div className="relative">
              {useCustomPrompt ? (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-3">
                      <div className="flex justify-between items-center">
                          <label className="text-xs text-gray-400 font-medium">Instrucciones Adicionales</label>
                          <span className="text-[10px] text-[#00D4B3] bg-[#00D4B3]/10 px-2 py-0.5 rounded border border-[#00D4B3]/20">Modo Edición</span>
                      </div>
                      <textarea 
                          value={customPrompt}
                          onChange={(e) => setCustomPrompt(e.target.value)}
                          className="w-full h-48 bg-[#0F1419] border border-[#00D4B3]/30 rounded-xl p-4 text-sm text-gray-300 font-mono leading-relaxed focus:outline-none focus:border-[#00D4B3] transition-colors resize-none shadow-inner placeholder:text-gray-600"
                          placeholder={DEFAULT_PROMPT_PREVIEW}
                      />
                  </div>
              ) : (
                  <div className="bg-[#0F1419] border border-[#6C757D]/10 rounded-xl p-6 flex flex-col gap-4 group hover:border-[#00D4B3]/20 transition-colors cursor-default animate-in fade-in duration-300 relative overflow-hidden">
                       <div className="flex items-center gap-3 relative z-10">
                            <CheckCircle2 size={18} className="text-[#00D4B3]" />
                            <h4 className="text-[#00D4B3] font-bold text-sm">
                               Configuración Optimizada
                            </h4>
                       </div>
                       
                       <p className="text-[#94A3B8] text-sm leading-relaxed relative z-10">
                            {DEFAULT_PROMPT_PREVIEW}
                       </p>

                       <div className="flex flex-wrap gap-2 relative z-10 mt-2">
                            {['Google Search Live', 'Validación 200 OK', 'Anti-Hallucination', 'Premium Sources'].map((tag, i) => (
                                <span key={i} className="text-[10px] bg-[#151A21] text-gray-400 border border-gray-700 px-2 py-1 rounded font-bold uppercase tracking-wider">
                                    {tag}
                                </span>
                            ))}
                       </div>
                       
                       <div className="absolute right-[-20px] top-[-20px] opacity-5">
                            <svg width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                       </div>
                  </div>
              )}
          </div>
          
      </div>

      <button
            onClick={handleGenerate}
            className={`
               w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all relative overflow-hidden
               bg-[#00D4B3] hover:bg-[#00bda0] text-[#0A2540] shadow-lg shadow-[#00D4B3]/25 hover:shadow-[#00D4B3]/40 hover:-translate-y-0.5
            `}
         >
            <Play size={20} fill="currentColor" />
            Iniciar Curaduría
      </button>

      <div className="text-center">
            <p className="text-[#6C757D] text-xs">
                La curaduría validará la disponibilidad de enlaces externamente.
            </p>
      </div>

    </div>
  );
}

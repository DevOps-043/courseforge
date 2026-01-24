
import { useState, useEffect } from 'react';
import { Esp02Route, TemarioEsp02, Esp02StepState } from '../../types/syllabus.types';
import { syllabusService } from '@/domains/syllabus/services/syllabus.service';
import { SyllabusRouteSelector } from './SyllabusRouteSelector';
import { SyllabusViewer } from './SyllabusViewer';
import { SyllabusImportForm } from './SyllabusImportForm';

interface SyllabusGenerationContainerProps {
  artifactId: string;
  initialObjetivos: string[];
  initialIdeaCentral: string;
  onNext?: () => void;
}

type TabMode = 'GENERATE' | 'IMPORT';

export function SyllabusGenerationContainer({ artifactId, initialObjetivos, initialIdeaCentral, onNext }: SyllabusGenerationContainerProps) {
  const [activeTab, setActiveTab] = useState<TabMode>('GENERATE');
  const [route, setRoute] = useState<Esp02Route | null>('B_NO_SOURCE'); // Default a IA
  const [status, setStatus] = useState<Esp02StepState>('STEP_DRAFT');
  const [temario, setTemario] = useState<TemarioEsp02 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  const handleGenerate = async () => {
    if (!route) return;
    setStatus('STEP_GENERATING');
    setError(null);

    try {
      // Inicia generación (puede retornar temario inmediato o status: processing)
      const result = await syllabusService.startGeneration({
        artifactId,
        route,
        objetivos: initialObjetivos,
        ideaCentral: initialIdeaCentral
      });

      // Si retorna temario inmediato (Local mode)
      if (result.modules) {
        processResult(result as any);
      } 
      // Si es background processing, el useEffect se encargará del polling
      
    } catch (err: any) {
      console.error(err);
      setError(err.message);
      setStatus('STEP_ESCALATED');
    }
  };

  // Helper para procesar resultado
  const processResult = (generatedTemario: TemarioEsp02) => {
      const validation = syllabusService.validateTemario(generatedTemario, initialObjetivos);
      const completeTemario: TemarioEsp02 = {
        ...generatedTemario,
        route: route || 'B_NO_SOURCE',
        validation: {
          automatic_pass: validation.passed,
          checks: validation.checks
        },
        qa: { status: 'PENDING' }
      };
      setTemario(completeTemario);
      
      // FIX: Respetar el estado que viene de BD si existe, sino READY_FOR_QA
      setStatus((generatedTemario.state as Esp02StepState) || 'STEP_READY_FOR_QA');
  };

  // CHECK INITIAL STATE
  useEffect(() => {
    const checkExisting = async () => {
        try {
            const data = await syllabusService.getSyllabus(artifactId);
            if (data?.modules?.length > 0) {
                processResult(data);
            }
        } catch (e) {
            // Ignorar error si no existe
        }
    };
    checkExisting();
  }, [artifactId]);

  // POLLING EFFECT
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (status === 'STEP_GENERATING') {
        console.log('Iniciando polling de Syllabus...');
        interval = setInterval(async () => {
            try {
                const data = await syllabusService.getSyllabus(artifactId);
                if (data && data.modules && data.modules.length > 0) {
                     console.log('Syllabus detectado mediante polling!');
                     processResult(data);
                     // El cambio de estado detendrá el polling
                }
            } catch (e) {
                console.error("Polling error (ignorable):", e);
            }
        }, 3000);
    }

    return () => clearInterval(interval);
  }, [status, artifactId]);

  const handleImport = (modules: any[]) => {
    // Validar y setear
    const importedTemario: TemarioEsp02 = {
      route: 'B_NO_SOURCE', // Asumimos B por simplicidad, o agregamos "IMPORTED"
      modules,
      validation: {
        automatic_pass: true, // Asumimos manual es correcto o corremos validación
        checks: []
      },
      qa: { status: 'PENDING' }
    };
    
    // Validar real
    const validation = syllabusService.validateTemario(importedTemario);
    importedTemario.validation = { 
        automatic_pass: validation.passed, 
        checks: validation.checks 
    };

    setTemario(importedTemario);
    setStatus('STEP_READY_FOR_QA');
  };

  const [isObjectivesOpen, setIsObjectivesOpen] = useState(false);

  // Limpiar el título/idea central para mostrar algo legible
  const cleanTitle = (initialIdeaCentral || 'Curso sin nombre')
    .replace(/(TEMA:|IDEA PRINCIPAL:|PÚBLICO:|RESULTADOS:)/g, '')
    .split('.')[0]
    .trim();

  // Funcion para guardar edicion de modulos
  const handleSaveModules = async (newModules: any[]) => {
      if (!temario) return;
      
      try {
          // Actualización optimista local
          const updatedTemario = { ...temario, modules: newModules };
          setTemario(updatedTemario);
          
          // Actualización en DB
          await syllabusService.updateModules(artifactId, newModules);
          console.log('Módulos actualizados correctamente');
      } catch (e) {
          console.error('Error guardando módulos:', e);
          // Opcional: Revertir si falla o mostrar toast
      }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-20">
      
      {/* Header Styled as Screenshot */}
      <div className="bg-white dark:bg-[#1E2329] rounded-2xl border border-gray-200 dark:border-white/5 p-8 relative overflow-hidden">
        <div className="relative z-10">
            <div className="flex items-center gap-4 mb-4">
                <div className="p-2.5 bg-[#00D4B3]/10 rounded-xl flex-shrink-0">
                    <svg className="w-6 h-6 text-[#00D4B3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                </div>
                <div>
                   <h2 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">Crear Temario</h2>
                   <p className="text-gray-500 dark:text-white/40 text-xs mt-1 font-medium tracking-wide">PASO 2 DEL PROCESO</p>
                </div>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed max-w-3xl">
                Define la estructura modular del curso <strong className="text-gray-900 dark:text-white">"{cleanTitle}"</strong>.
                Puedes generar con IA o importar un temario existente.
            </p>
        </div>
        {/* Background Gradient */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#0A2540] opacity-5 dark:opacity-20 blur-[100px] rounded-full pointer-events-none" />
      </div>

      {/* Accordion Objetivos */}
      <div className="space-y-2">
          <button 
            onClick={() => setIsObjectivesOpen(!isObjectivesOpen)}
            className="w-full bg-white dark:bg-[#1E2329] border border-gray-200 dark:border-white/5 rounded-xl px-6 py-4 flex justify-between items-center cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-all group"
          >
            <div className="flex items-center gap-4">
                <div className="p-2 bg-gray-100 dark:bg-white/5 rounded-lg group-hover:bg-gray-200 dark:group-hover:bg-white/10 transition-colors">
                   <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-gray-900 dark:text-white font-medium">Objetivos de Aprendizaje</span>
                    <span className="px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-xs text-gray-600 dark:text-white/70 font-mono border border-gray-200 dark:border-white/5">
                        {initialObjetivos.length}
                    </span>
                </div>
            </div>
            <svg 
                className={`w-5 h-5 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isObjectivesOpen ? 'rotate-180' : ''}`} 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
            >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {isObjectivesOpen && (
              <div className="bg-gray-50 dark:bg-[#1E2329]/50 border border-gray-200 dark:border-white/5 rounded-xl p-6 animate-in slide-in-from-top-2 duration-200">
                  <ul className="space-y-3">
                      {initialObjetivos.map((obj, idx) => (
                          <li key={idx} className="flex gap-4 text-sm text-gray-600 dark:text-gray-300 items-start">
                              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#00D4B3]/10 text-[#00D4B3] flex items-center justify-center text-xs font-mono border border-[#00D4B3]/20 mt-0.5">
                                  {idx + 1}
                              </span>
                              <span className="leading-relaxed">{obj}</span>
                          </li>
                      ))}
                  </ul>
              </div>
          )}
      </div>

      {!temario && status === 'STEP_DRAFT' && (
        <>
            {/* Tabs */}
            <div className="grid grid-cols-2 gap-4">
                <button
                    onClick={() => setActiveTab('GENERATE')}
                    className={`
                        p-6 rounded-xl border-2 text-left transition-all relative overflow-hidden group
                        ${activeTab === 'GENERATE' 
                            ? 'border-[#00D4B3] bg-[#00D4B3]/5' 
                            : 'border-gray-200 dark:border-white/5 bg-white dark:bg-[#1E2329] hover:bg-gray-50 dark:hover:bg-white/5'}
                    `}
                >
                    <div className="flex items-center gap-3 mb-2">
                         <div className={`p-1.5 rounded ${activeTab === 'GENERATE' ? 'bg-[#00D4B3] text-[#0A2540]' : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400'}`}>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                         </div>
                         <h3 className={`font-bold ${activeTab === 'GENERATE' ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>Generar con IA</h3>
                    </div>
                    <p className="text-sm text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-400 transition-colors">La IA crea el temario basándose en los objetivos.</p>
                    
                    {activeTab === 'GENERATE' && (
                        <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-[#00D4B3] shadow-[0_0_10px_#00D4B3]" />
                    )}
                </button>

                <button
                    onClick={() => setActiveTab('IMPORT')}
                    className={`
                        p-6 rounded-xl border-2 text-left transition-all relative overflow-hidden group
                        ${activeTab === 'IMPORT' 
                            ? 'border-[#00D4B3] bg-[#00D4B3]/5' 
                            : 'border-gray-200 dark:border-white/5 bg-white dark:bg-[#1E2329] hover:bg-gray-50 dark:hover:bg-white/5'}
                    `}
                >
                    <div className="flex items-center gap-3 mb-2">
                         <div className={`p-1.5 rounded ${activeTab === 'IMPORT' ? 'bg-[#00D4B3] text-[#0A2540]' : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400'}`}>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
                         </div>
                         <h3 className={`font-bold ${activeTab === 'IMPORT' ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>Importar Temario</h3>
                    </div>
                    <p className="text-sm text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-400 transition-colors">Pega un temario existente en formato Markdown.</p>

                    {activeTab === 'IMPORT' && (
                        <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-[#00D4B3] shadow-[0_0_10px_#00D4B3]" />
                    )}
                </button>
            </div>

            {/* Content Area */}
            <div className="mt-2">
                {activeTab === 'GENERATE' && (
                    <div className="space-y-6">
                        <div className="bg-white dark:bg-[#1E2329] border border-gray-200 dark:border-white/5 rounded-2xl p-6">
                            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-6">Método de Generación</h4>
                            <SyllabusRouteSelector 
                                selectedRoute={route} 
                                onSelect={setRoute} 
                            />
                        </div>

                        <button
                            onClick={handleGenerate}
                            className={`
                                w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all
                                ${route 
                                    ? 'bg-[#00D4B3] text-[#0A2540] hover:bg-[#00bda0] shadow-[0_4px_20px_rgba(0,212,179,0.2)]' 
                                    : 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'}
                            `}
                            disabled={!route}
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                             Generar Temario con IA
                        </button>
                    </div>
                )}

                {activeTab === 'IMPORT' && (
                    <SyllabusImportForm onImport={handleImport} />
                )}
            </div>
        </>
      )}

      {/* States: Loading, Error, Result */}
      {status === 'STEP_GENERATING' && (
        <div className="bg-white dark:bg-[#1E2329] rounded-2xl border border-gray-200 dark:border-white/5 p-12 text-center">
            <div className="inline-block relative w-16 h-16 mb-6">
                {/* Spinner Ring */}
                <div className="absolute inset-0 rounded-full border-4 border-[#00D4B3]/20 border-t-[#00D4B3] animate-spin"></div>
                {/* Centered Icon */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <svg className="w-6 h-6 text-[#00D4B3]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Generando Estructura Inteligente</h3>
            <p className="text-gray-500 dark:text-gray-400">Analizando objetivos, investigando tendencias y estructurando módulos...</p>
        </div>
      )}

      {temario && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Temario Generado
                </h3>
            </div>
            <SyllabusViewer 
                modules={temario.modules} 
                validation={temario.validation}
                metadata={temario.source_summary as any}
                onSave={handleSaveModules}
                isEditable={true}
            />

            {/* REVISION PANEL FASE 2 */}
            <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-white/5 rounded-2xl p-6 mt-8">
                <h3 className="text-gray-900 dark:text-white font-bold mb-4 flex items-center gap-2">
                    <svg className="w-4 h-4 text-[#00D4B3]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    Revisión Fase 2: Estructura
                </h3>
                
                <textarea
                    className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-white/10 rounded-xl p-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 min-h-[100px] placeholder-gray-400 dark:placeholder-gray-600"
                    placeholder="Escribe tus comentarios o feedback sobre la estructura del temario..."
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    disabled={status === 'STEP_APPROVED'}
                />

                <div className="flex items-center gap-4 mt-4">
                    {status !== 'STEP_APPROVED' && status !== 'STEP_REJECTED' && (
                        <>
                            <button 
                                onClick={async () => {
                                    try {
                                        await syllabusService.updateStatus(artifactId, 'STEP_APPROVED', reviewNotes);
                                        // Aquí deberíamos notificar al padre o refrescar status, pero por simplicidad actualizamos local
                                        setStatus('STEP_APPROVED');
                                    } catch(e) { console.error(e); }
                                }}
                                className="flex-1 bg-[#00D4B3]/10 hover:bg-[#00D4B3]/20 text-[#00D4B3] border border-[#00D4B3]/20 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Aprobar Fase 2
                            </button>
                            <button 
                                onClick={async () => {
                                     try {
                                        await syllabusService.updateStatus(artifactId, 'STEP_REJECTED', reviewNotes);
                                        setStatus('STEP_REJECTED');
                                     } catch(e) { console.error(e); }
                                }}
                                className="flex-1 bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/20 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                Rechazar Fase 2
                            </button>
                        </>
                    )}

                    {status === 'STEP_APPROVED' && (
                        <div className="w-full flex gap-4">
                                <div className="flex-1 bg-[#00D4B3]/20 text-[#00D4B3] py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                Fase 2 Aprobada
                            </div>
                            {onNext && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        console.log('Navigating to next step...');
                                        if (onNext) onNext();
                                    }}
                                    className="flex-1 bg-[#1F5AF6] hover:bg-[#1548c7] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1F5AF6]/20"
                                >
                                    Continuar a Plan
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* BOTÓN DESCARTAR / RESETEAR MEJORADO */}
                {(status === 'STEP_REJECTED' || status === 'STEP_READY_FOR_QA') && (
                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-white/5">
                        <button 
                            onClick={async () => {
                                if(!confirm("¿Estás seguro de que quieres eliminar este temario y volver a generarlo?")) return;
                                try {
                                    await syllabusService.deleteSyllabusContent(artifactId);
                                    setTemario(null); 
                                    setStatus('STEP_DRAFT');
                                    setReviewNotes('');
                                    setRoute(null);
                                } catch (e) { console.error(e); }
                            }}
                            className="w-full flex items-center justify-center gap-2 text-gray-500 hover:text-red-400 text-sm transition-colors py-2"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            Descartar temario actual y volver a empezar
                        </button>
                    </div>
                )}
            </div>
        </div>
      )}

    </div>
  );
}

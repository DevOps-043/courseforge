import { useState } from 'react';
import { SyllabusModule } from '../../types/syllabus.types';

interface SyllabusViewerProps {
  modules: SyllabusModule[];
  validation?: {
      checks: Array<{ code: string; message: string; pass: boolean }>;
      automatic_pass: boolean;
  };
  metadata?: {
      search_queries?: string[];
      research_summary?: string;
      model_used?: string;
      validation_attempts?: number;
  };
}

export function SyllabusViewer({ modules, validation, metadata }: SyllabusViewerProps) {
  const [activeTab, setActiveTab] = useState<'SYLLABUS' | 'VALIDATION'>('SYLLABUS');
  const [expandedModules, setExpandedModules] = useState<number[]>([0]);

  const toggleModule = (index: number) => {
    setExpandedModules(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  if (!modules || modules.length === 0) {
    return (
      <div className="p-12 text-center text-gray-500 bg-[#151A21] rounded-2xl border border-dashed border-gray-700">
        <p>No se ha generado contenido para el temario.</p>
      </div>
    );
  }

  const totalLessons = modules.reduce((acc, m) => acc + m.lessons.length, 0);

  return (
    <div className="space-y-6">
      
      {/* TABS CONTROL */}
      <div className="flex gap-4 border-b border-white/5 pb-1">
          <button
            onClick={() => setActiveTab('SYLLABUS')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative top-[1px] ${
                activeTab === 'SYLLABUS' 
                ? 'text-white border-b-2 border-[#00D4B3]' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
              Estructura del Temario
          </button>
          <button
            onClick={() => setActiveTab('VALIDATION')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative top-[1px] flex items-center gap-2 ${
                activeTab === 'VALIDATION' 
                ? 'text-white border-b-2 border-[#00D4B3]' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
              <span>Validación & Fuentes</span>
              {validation?.automatic_pass && (
                  <svg className="w-4 h-4 text-[#00D4B3]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
          </button>
      </div>

      {activeTab === 'VALIDATION' && (
          <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
              {/* VALIDATION CHECKS */}
              <div className="bg-[#151A21] rounded-2xl border border-white/5 p-6 space-y-4">
                  <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Reglas de Calidad (Agentic Checks)</h4>
                  <div className="grid gap-3">
                      {validation?.checks.map((check, idx) => (
                          <div key={idx} className={`px-4 py-3 rounded-xl border flex items-start gap-3 ${
                              check.pass 
                                ? 'bg-[#151A21] border-[#00D4B3]/20' 
                                : 'bg-[#151A21] border-red-500/20'
                          }`}>
                              <div className={`mt-0.5 flex-shrink-0 ${check.pass ? 'text-[#00D4B3]' : 'text-red-500'}`}>
                                  {check.pass 
                                      ? <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                      : <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                  }
                              </div>
                              <div className="text-sm">
                                <span className={`font-mono font-bold mr-2 ${check.pass ? 'text-[#00D4B3]' : 'text-red-500'}`}>
                                    {check.code}
                                </span>
                                <span className={check.pass ? 'text-gray-300' : 'text-red-400'}>
                                    {check.message}
                                </span>
                              </div>
                          </div>
                      ))}
                      {(!validation?.checks || validation.checks.length === 0) && (
                          <p className="text-gray-500 text-sm">No hay reporte de validación disponible.</p>
                      )}
                  </div>
              </div>

              {/* SEARCH QUERIES */}
              <div className="bg-[#151A21] rounded-2xl border border-white/5 p-6">
                  <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Fuentes de Investigación (Google Search)</h4>
                  
                  {metadata?.search_queries && metadata.search_queries.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                          {metadata.search_queries.map((q, idx) => (
                              <a 
                                key={idx} 
                                href={`https://www.google.com/search?q=${encodeURIComponent(q)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-blue-300 flex items-center gap-2 hover:bg-white/10 hover:border-blue-400/30 hover:text-blue-200 transition-all"
                              >
                                  <svg className="w-3.5 h-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                  {q}
                              </a>
                          ))}
                      </div>
                  ) : (
                      <p className="text-gray-500 text-sm italic">No se detectaron consultas de búsqueda específicas o se usó conocimiento base.</p>
                  )}

                  {metadata?.research_summary && (
                      <div className="mt-6 pt-6 border-t border-white/5">
                          <p className="text-xs font-bold text-gray-500 mb-2">RESUMEN DE INVESTIGACIÓN</p>
                          <div className="text-sm text-gray-400 leading-relaxed max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                              {metadata.research_summary.split('###').map((section, i) => {
                                  if (!section.trim()) return null;
                                  
                                  const sectionLines = section.trim().split('\n');
                                  // Heuristic: First line is title if we are ensuring sections split by ###, or if it looks like a header
                                  const isTitle = i > 0 || metadata.research_summary?.includes('###');
                                  
                                  const title = isTitle ? sectionLines[0] : '';
                                  const contentLines = isTitle ? sectionLines.slice(1) : sectionLines;

                                  if (!title && contentLines.length === 0) return null;

                                  return (
                                      <div key={i} className="mb-6 last:mb-0">
                                          {title && <h5 className="font-bold text-white mb-3 text-base">{title.replace(/^\s*#+\s*/, '')}</h5>}
                                          
                                          <div className="space-y-2">
                                              {contentLines.map((line, lIdx) => {
                                                  if (!line.trim()) return null;
                                                  
                                                  // List detection
                                                  const isList = /^\s*[\-\*]\s/.test(line);
                                                  const cleanLine = line.replace(/^\s*[\-\*]\s/, '');
                                                  
                                                  // Bold parsing: **text**
                                                  const parts = cleanLine.split(/(\*\*.*?\*\*)/g);

                                                  return (
                                                      <div key={lIdx} className={`text-sm leading-relaxed ${isList ? 'flex gap-2 pl-2' : ''}`}>
                                                          {isList && <span className="text-[#00D4B3] mt-1.5 w-1.5 h-1.5 rounded-full bg-[#00D4B3] shrink-0 block" />}
                                                          <p className={isList ? 'text-gray-300' : 'text-gray-400'}>
                                                              {parts.map((part, pIdx) => {
                                                                  if (part.startsWith('**') && part.endsWith('**')) {
                                                                      return <strong key={pIdx} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
                                                                  }
                                                                  return part;
                                                              })}
                                                          </p>
                                                      </div>
                                                  );
                                              })}
                                          </div>
                                      </div>
                                  )
                              })}
                          </div>
                      </div>
                  )}
              </div>
          </div>
      )}

      {activeTab === 'SYLLABUS' && (
        <>
            {/* Resumen Header */}
            <div className="flex items-center gap-4 bg-[#151A21] border border-white/5 p-4 rounded-xl text-sm">
         <div className="flex items-center gap-2 text-white/70">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            <span className="font-semibold text-white">{modules.length} módulos</span>
         </div>
         <div className="w-px h-4 bg-white/10" />
         <div className="flex items-center gap-2 text-white/70">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            <span className="font-semibold text-white">{totalLessons} lecciones</span>
         </div>
         <div className="ml-auto">
             <span className="bg-[#00D4B3]/10 text-[#00D4B3] px-2 py-1 rounded text-xs font-bold border border-[#00D4B3]/20">
                 Validación OK
             </span>
         </div>
      </div>

      <div className="space-y-4">
      {modules.map((module, index) => {
        const isExpanded = expandedModules.includes(index);
        
        return (
            <div 
            key={index} 
            className="group bg-[#151A21] rounded-2xl border border-white/5 overflow-hidden transition-all duration-300"
            >
            {/* Header del Módulo (Clickable) */}
            <button 
                onClick={() => toggleModule(index)}
                className="w-full text-left px-6 py-5 flex justify-between items-start hover:bg-white/5 transition-colors"
            >
                <div>
                <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-bold text-white group-hover:text-[#00D4B3] transition-colors">
                        Módulo {index + 1}: {module.title}
                    </h3>
                </div>
                {module.objective_general_ref && (
                    <p className="text-sm text-gray-400 mt-1 line-clamp-1">
                        Objetivo: {module.objective_general_ref}
                    </p>
                )}
                </div>
                <div className="flex items-center gap-3 pl-4">
                    <span className="text-xs font-medium bg-[#0F1419] px-2.5 py-1 rounded-md border border-white/10 text-gray-400">
                        {module.lessons.length} lecciones
                    </span>
                    <svg 
                        className={`w-5 h-5 text-gray-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} 
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>

            {/* Lista de Lecciones (Collapsible) */}
            {isExpanded && (
                <div className="border-t border-white/5 bg-[#0F1419]/50 animate-in slide-in-from-top-1 duration-200">
                <div className="p-4 space-y-2">
                    {module.lessons.map((lesson, lIndex) => (
                    <div key={lIndex} className="p-4 rounded-xl hover:bg-white/5 transition-colors group/item border border-transparent hover:border-white/5">
                        <div className="flex gap-4">
                            {/* Número de lección badge */}
                            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#1F5AF6]/10 text-[#1F5AF6] flex items-center justify-center text-xs font-bold font-mono border border-[#1F5AF6]/20 mt-0.5">
                                {index + 1}.{lIndex + 1}
                            </div>
                            
                            <div className="flex-grow min-w-0">
                                <h4 className="text-base font-medium text-gray-200 mb-1.5 group-hover/item:text-white transition-colors">
                                {lesson.title}
                                </h4>
                                
                                {/* Info extra si existe */}
                                <div className="text-sm text-gray-500 flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <svg className="w-3.5 h-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        <span className="truncate opacity-80">{lesson.objective_specific}</span>
                                    </div>
                                    {lesson.estimated_minutes && (
                                        <div className="flex items-center gap-2">
                                            <svg className="w-3.5 h-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            <span className="opacity-80 font-mono text-xs">{lesson.estimated_minutes} min</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    ))}
                </div>
                </div>
            )}
            </div>
        );
      })}
      </div>
      </>
      )}
    </div>
  );
}

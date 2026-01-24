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
  onSave?: (newModules: SyllabusModule[]) => Promise<void>;
  isEditable?: boolean;
}

export function SyllabusViewer({ modules, validation, metadata, onSave, isEditable = false }: SyllabusViewerProps) {
  const [activeTab, setActiveTab] = useState<'SYLLABUS' | 'VALIDATION'>('SYLLABUS');
  const [expandedModules, setExpandedModules] = useState<number[]>([0]);
  
  // Edit State
  const [editingModuleIdx, setEditingModuleIdx] = useState<number | null>(null);
  const [editedModules, setEditedModules] = useState<SyllabusModule[]>([]);

  // Initialize edited state when modules change (or when entering edit mode)
  /*Effect Logic*/
  
  const handleStartEdit = (idx: number) => {
      setEditingModuleIdx(idx);
      setEditedModules(JSON.parse(JSON.stringify(modules))); // Deep copy
  };

  const handleCancelEdit = () => {
      setEditingModuleIdx(null);
      setEditedModules([]);
  };

  const handleSaveEdit = async () => {
      if (onSave && editedModules.length > 0) {
          await onSave(editedModules);
      }
      setEditingModuleIdx(null);
  };
  
  const updateModuleTitle = (idx: number, newTitle: string) => {
      const updated = [...editedModules];
      updated[idx].title = newTitle;
      setEditedModules(updated);
  };

  const updateLesson = (mIdx: number, lIdx: number, field: string, value: any) => {
      const updated = [...editedModules];
      // @ts-ignore
      updated[mIdx].lessons[lIdx][field] = value;
      setEditedModules(updated);
  };


  const toggleModule = (index: number) => {
    if (editingModuleIdx !== null) return; // Disable toggle while editing
    setExpandedModules(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  if (!modules || modules.length === 0) {
    return (
      <div className="p-12 text-center text-gray-500 bg-gray-50 dark:bg-[#151A21] rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
        <p>No se ha generado contenido para el temario.</p>
      </div>
    );
  }

  const totalLessons = modules.reduce((acc, m) => acc + m.lessons.length, 0);

  return (
    <div className="space-y-6">
      
      {/* TABS CONTROL */}
      <div className="flex gap-4 border-b border-gray-200 dark:border-white/5 pb-1">
          <button
            onClick={() => setActiveTab('SYLLABUS')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative top-[1px] ${
                activeTab === 'SYLLABUS' 
                ? 'text-gray-900 dark:text-white border-b-2 border-[#00D4B3]' 
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
              Estructura del Temario
          </button>
          <button
            onClick={() => setActiveTab('VALIDATION')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative top-[1px] flex items-center gap-2 ${
                activeTab === 'VALIDATION' 
                ? 'text-gray-900 dark:text-white border-b-2 border-[#00D4B3]' 
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
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
              {/* VALIDATION CHECKS content same as before */}
              <div className="bg-white dark:bg-[#151A21] rounded-2xl border border-gray-200 dark:border-white/5 p-6 space-y-4">
                  <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-4">Reglas de Calidad (Agentic Checks)</h4>
                  <div className="grid gap-3">
                      {validation?.checks.map((check, idx) => (
                          <div key={idx} className={`px-4 py-3 rounded-xl border flex items-start gap-3 ${
                              check.pass 
                                ? 'bg-white dark:bg-[#151A21] border-[#00D4B3]/20' 
                                : 'bg-red-50 dark:bg-[#151A21] border-red-500/20'
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
                                <span className={check.pass ? 'text-gray-600 dark:text-gray-300' : 'text-red-600 dark:text-red-400'}>
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

              {/* SEARCH QUERIES content same as before */}
              <div className="bg-white dark:bg-[#151A21] rounded-2xl border border-gray-200 dark:border-white/5 p-6">
                  <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-4">Fuentes de Investigación (Google Search)</h4>
                  
                  {metadata?.search_queries && metadata.search_queries.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                          {metadata.search_queries.map((q, idx) => (
                              <a 
                                key={idx} 
                                href={`https://www.google.com/search?q=${encodeURIComponent(q)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm text-blue-600 dark:text-blue-300 flex items-center gap-2 hover:bg-gray-200 dark:hover:bg-white/10 hover:border-blue-400/30 hover:text-blue-700 dark:hover:text-blue-200 transition-all"
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
                      <div className="mt-6 pt-6 border-t border-gray-200 dark:border-white/5">
                          <p className="text-xs font-bold text-gray-500 mb-2">RESUMEN DE INVESTIGACIÓN</p>
                          <div className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                              {metadata.research_summary.split('###').map((section, i) => {
                                  if (!section.trim()) return null;
                                  const sectionLines = section.trim().split('\n');
                                  const isTitle = i > 0 || metadata.research_summary?.includes('###');
                                  const title = isTitle ? sectionLines[0] : '';
                                  const contentLines = isTitle ? sectionLines.slice(1) : sectionLines;
                                  if (!title && contentLines.length === 0) return null;
                                  return (
                                      <div key={i} className="mb-6 last:mb-0">
                                          {title && <h5 className="font-bold text-gray-900 dark:text-white mb-3 text-base">{title.replace(/^\s*#+\s*/, '')}</h5>}
                                          <div className="space-y-2">
                                              {contentLines.map((line, lIdx) => {
                                                  if (!line.trim()) return null;
                                                  const isList = /^\s*[\-\*]\s/.test(line);
                                                  const cleanLine = line.replace(/^\s*[\-\*]\s/, '');
                                                  const parts = cleanLine.split(/(\*\*.*?\*\*)/g);
                                                  return (
                                                      <div key={lIdx} className={`text-sm leading-relaxed ${isList ? 'flex gap-2 pl-2' : ''}`}>
                                                          {isList && <span className="text-[#00D4B3] mt-1.5 w-1.5 h-1.5 rounded-full bg-[#00D4B3] shrink-0 block" />}
                                                          <p className={isList ? 'text-gray-700 dark:text-gray-300' : 'text-gray-600 dark:text-gray-400'}>
                                                              {parts.map((part, pIdx) => {
                                                                  if (part.startsWith('**') && part.endsWith('**')) {
                                                                      return <strong key={pIdx} className="text-gray-900 dark:text-white font-semibold">{part.slice(2, -2)}</strong>;
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
            <div className="flex items-center gap-4 bg-white dark:bg-[#151A21] border border-gray-200 dark:border-white/5 p-4 rounded-xl text-sm justify-between">
              <div className="flex items-center gap-4">
                 <div className="flex items-center gap-2 text-gray-600 dark:text-white/70">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                    <span className="font-semibold text-gray-900 dark:text-white">{modules.length} módulos</span>
                 </div>
                 <div className="w-px h-4 bg-gray-200 dark:bg-white/10" />
                 <div className="flex items-center gap-2 text-gray-600 dark:text-white/70">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                    <span className="font-semibold text-gray-900 dark:text-white">{totalLessons} lecciones</span>
                 </div>
              </div>
              <div className="flex items-center gap-3">
                 <span className="bg-[#00D4B3]/10 text-[#00D4B3] px-2 py-1 rounded text-xs font-bold border border-[#00D4B3]/20">
                     Validación OK
                 </span>
              </div>
            </div>

      <div className="space-y-4">
      {modules.map((module, index) => {
        const isEditing = editingModuleIdx === index;
        const displayModule = isEditing && editedModules.length > 0 ? editedModules[index] : module;
        const isExpanded = expandedModules.includes(index) || isEditing;
        
        return (
            <div 
            key={index} 
            className={`group bg-white dark:bg-[#151A21] rounded-2xl border ${isEditing ? 'border-[#00D4B3] ring-1 ring-[#00D4B3]/30' : 'border-gray-200 dark:border-white/5'} overflow-hidden transition-all duration-300`}
            >
            {/* Header del Módulo */}
            <div className="w-full px-6 py-5 flex justify-between items-start">
                <div onClick={() => !isEditing && toggleModule(index)} className={`flex-1 ${!isEditing && 'cursor-pointer'}`}>
                    <div className="flex items-center gap-2 mb-1">
                        {isEditing ? (
                             <input 
                                className="bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 text-lg font-bold text-gray-900 dark:text-white w-full focus:outline-none focus:border-[#00D4B3] transition-all focus:bg-white dark:focus:bg-[#151A21] placeholder-gray-400 dark:placeholder-gray-600 shadow-inner"
                                value={displayModule.title}
                                onChange={(e) => updateModuleTitle(index, e.target.value)}
                             />
                        ) : (
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white group-hover:text-[#00D4B3] transition-colors">
                                Módulo {index + 1}: {displayModule.title}
                            </h3>
                        )}
                    </div>
                </div>
                
                <div className="flex items-center gap-3 pl-4">
                    {!isEditing && isEditable && (
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                handleStartEdit(index);
                            }} 
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-lg text-gray-500 dark:text-gray-400 hover:text-[#00D4B3] transition-colors border border-gray-200 dark:border-white/5 hover:border-[#00D4B3]/30 text-xs font-medium"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            <span>Editar</span>
                        </button>
                    )}
                    
                    {isEditing ? (
                        <div className="flex items-center gap-2">
                             <button onClick={handleSaveEdit} className="p-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-500 rounded-lg"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                             <button onClick={handleCancelEdit} className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                        </div>
                    ) : (
                        <div onClick={() => toggleModule(index)} className="cursor-pointer flex items-center gap-3">
                             <span className="text-xs font-medium bg-gray-100 dark:bg-[#0F1419] px-2.5 py-1 rounded-md border border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400">
                                {displayModule.lessons.length} lecciones
                            </span>
                            <svg 
                                className={`w-5 h-5 text-gray-400 dark:text-gray-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} 
                                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    )}
                </div>
            </div>

            {/* Lista de Lecciones (Collapsible) */}
            {isExpanded && (
                <div className="border-t border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-[#0F1419]/50 animate-in slide-in-from-top-1 duration-200">
                <div className="p-4 space-y-2">
                    {displayModule.lessons.map((lesson, lIndex) => (
                    <div key={lIndex} className="p-4 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-colors group/item border border-transparent hover:border-gray-200 dark:hover:border-white/5">
                        <div className="flex gap-4">
                            {/* Número de lección badge */}
                            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#1F5AF6]/10 text-[#1F5AF6] flex items-center justify-center text-xs font-bold font-mono border border-[#1F5AF6]/20 mt-0.5">
                                {index + 1}.{lIndex + 1}
                            </div>
                            
                            <div className="flex-grow min-w-0 space-y-2">
                                {isEditing ? (
                                    <div className="space-y-3">
                                        <input 
                                            className="w-full bg-white dark:bg-[#0F1419] border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 text-base font-medium text-gray-900 dark:text-white focus:outline-none focus:border-[#00D4B3] transition-all focus:bg-white dark:focus:bg-[#151A21] placeholder-gray-400 dark:placeholder-gray-600"
                                            value={lesson.title}
                                            onChange={(e) => updateLesson(index, lIndex, 'title', e.target.value)}
                                            placeholder="Título de la lección"
                                        />
                                        <textarea
                                            className="w-full bg-white dark:bg-[#0F1419] border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:border-[#00D4B3] min-h-[80px] transition-all focus:bg-white dark:focus:bg-[#151A21] resize-none placeholder-gray-400 dark:placeholder-gray-600"
                                            value={lesson.objective_specific}
                                            onChange={(e) => updateLesson(index, lIndex, 'objective_specific', e.target.value)}
                                            placeholder="Objetivo específico de esta lección..."
                                        />
                                        <div className="flex items-center gap-3 bg-gray-50 dark:bg-[#151A21] rounded-xl px-4 py-2 border border-gray-200 dark:border-white/5 w-fit hover:border-gray-300 dark:hover:border-white/10 transition-colors group/time">
                                            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500 group-hover/time:bg-blue-500/20 transition-colors">
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            </div>
                                            <div className="w-px h-6 bg-gray-200 dark:bg-white/5" />
                                            <div className="flex flex-col justify-center">
                                                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-none mb-0.5">Tiempo Est.</span>
                                                <div className="flex items-baseline gap-1">
                                                     <input 
                                                        type="number"
                                                        className="bg-transparent border-none p-0 text-sm font-bold text-gray-900 dark:text-white w-12 focus:outline-none focus:ring-0 font-mono text-right appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                                        value={lesson.estimated_minutes}
                                                        onChange={(e) => updateLesson(index, lIndex, 'estimated_minutes', parseInt(e.target.value))}
                                                    />
                                                    <span className="text-xs text-gray-400 font-medium">min</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <h4 className="text-base font-medium text-gray-800 dark:text-gray-200 mb-1.5 group-hover/item:text-blue-600 dark:group-hover/item:text-white transition-colors">
                                            {lesson.title}
                                        </h4>
                                        <div className="text-sm text-gray-500 dark:text-gray-500 flex flex-col gap-1">
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
                                    </>
                                )}
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

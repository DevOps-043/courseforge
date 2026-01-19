import { useMemo, useState } from 'react';
import { CurationRow } from '../types/curation.types';
import { CurationRowItem } from './CurationRowItem';
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface CurationDashboardProps {
  rows: CurationRow[];
  onUpdateRow: (id: string, updates: Partial<CurationRow>) => void;
  isGenerating: boolean;
}

export function CurationDashboard({ rows, onUpdateRow, isGenerating }: CurationDashboardProps) {
  
  // 1. Stats Calculation
  const stats = useMemo(() => {
    return {
      total: rows.length,
      apta: rows.filter(r => r.apta === true).length,
      rejected: rows.filter(r => r.apta === false).length,
      pending: rows.filter(r => r.apta === null).length,
      auto: rows.filter(r => r.auto_evaluated).length
    };
  }, [rows]);

  // 2. Grouping Logic: Lesson -> Component -> Rows
  const groupedData = useMemo(() => {
    const groups: Record<string, Record<string, CurationRow[]>> = {};

    rows.forEach(row => {
      const lessonKey = row.lesson_title || row.lesson_id; // Fallback ID
      const componentKey = row.component;

      if (!groups[lessonKey]) groups[lessonKey] = {};
      if (!groups[lessonKey][componentKey]) groups[lessonKey][componentKey] = [];

      groups[lessonKey][componentKey].push(row);
    });

    return groups;
  }, [rows]);

  // Collapsible Lesson State
  const [collapsedLessons, setCollapsedLessons] = useState<Record<string, boolean>>({});
  
  const toggleLesson = (key: string) => {
    setCollapsedLessons(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (rows.length === 0 && !isGenerating) {
     return (
        <div className="flex flex-col items-center justify-center p-12 text-[#6C757D] border border-dashed border-[#1E2329] rounded-xl bg-[#0F1419]/50">
           <Layers className="mb-4 opacity-50" size={48} />
           <p className="text-lg font-medium text-[#E9ECEF]">No hay fuentes curadas aún.</p>
           <p className="text-sm">Inicia la curaduría para comenzar a buscar.</p>
        </div>
     );
  }

  return (
    <div className="space-y-6">
      
      {/* 1. Stats Bar */}
      <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-[#0F1419] border border-[#1E2329] shadow-sm">
         <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[#00D4B3]/10 text-[#00D4B3] border border-[#00D4B3]/20">
            <CheckCircle2 size={16} />
            <span className="font-bold">{stats.apta}</span>
            <span className="text-xs opacity-80 uppercase tracking-wide">Apta</span>
         </div>
         <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle size={16} />
            <span className="font-bold">{stats.rejected}</span>
            <span className="text-xs opacity-80 uppercase tracking-wide">No Apta</span>
         </div>
         <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertCircle size={16} />
            <span className="font-bold">{stats.pending}</span>
            <span className="text-xs opacity-80 uppercase tracking-wide">Sin Evaluar</span>
         </div>
         
         <div className="ml-auto text-xs text-[#6C757D] flex items-center gap-2">
            <span>{stats.auto} auto-clasificadas</span>
            <div className="h-4 w-px bg-[#1E2329] mx-2" />
            <span>Total: {stats.total}</span>
         </div>
      </div>

      {isGenerating && stats.total === 0 && (
         <div className="p-8 text-center animate-pulse text-[#00D4B3]">
            <p>Generando y buscando fuentes en tiempo real...</p>
            <p className="text-xs text-[#6C757D] mt-2">Puede tomar unos minutos.</p>
         </div>
      )}

      {/* 2. Lesson Groups */}
      <div className="space-y-4">
        {Object.entries(groupedData).map(([lessonTitle, components]) => {
          const isCollapsed = collapsedLessons[lessonTitle];
          
          // Stats per lesson
          const lessonRows = Object.values(components).flat();
          const lessonOk = lessonRows.filter(r => r.apta).length;
          const lessonTotal = lessonRows.length;
          const isComplete = lessonOk === lessonTotal && lessonTotal > 0;

          return (
            <div key={lessonTitle} className="border border-[#1E2329] rounded-xl overflow-hidden bg-[#0F1419]">
              {/* Lesson Header */}
              <button 
                 onClick={() => toggleLesson(lessonTitle)}
                 className="w-full flex items-center gap-3 p-4 bg-[#0F1419] hover:bg-[#1E2329]/50 transition-colors text-left"
              >
                 {isCollapsed ? <ChevronRight size={18} className="text-[#6C757D]" /> : <ChevronDown size={18} className="text-[#6C757D]" />}
                 
                 <div className="flex gap-2 items-center flex-1">
                    <h3 className={`font-semibold text-lg ${isComplete ? 'text-[#00D4B3]' : 'text-[#E9ECEF]'}`}>
                       {lessonTitle}
                    </h3>
                 </div>

                 <div className="text-xs font-mono text-[#6C757D] bg-[#151A21] px-2 py-1 rounded border border-[#1E2329]">
                    {lessonOk} / {lessonTotal} ok
                 </div>
              </button>

              {/* Components List */}
              <AnimatePresence>
                 {!isCollapsed && (
                    <motion.div 
                      key="content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="p-4 space-y-6 border-t border-[#1E2329]"
                    >
                       {Object.entries(components).map(([compName, compRows]) => (
                          <div key={compName} className="pl-2 border-l-2 border-[#1E2329]">
                             <div className="flex items-center gap-2 mb-3">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded bg-[#151A21] text-[#94A3B8] border border-[#1E2329]`}>
                                   {compName}
                                </span>
                                {compRows.some(r => r.is_critical) && (
                                   <span className="text-[10px] text-rose-400 font-bold bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">CRITICO</span>
                                )}
                                <span className="text-[#6C757D] text-xs">({compRows.length} fuentes)</span>
                             </div>

                             <div className="space-y-3">
                                {compRows.map(row => (
                                   <CurationRowItem 
                                      key={row.id} 
                                      row={row} 
                                      onUpdate={onUpdateRow} 
                                   />
                                ))}
                             </div>
                          </div>
                       ))}
                    </motion.div>
                 )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

    </div>
  );
}

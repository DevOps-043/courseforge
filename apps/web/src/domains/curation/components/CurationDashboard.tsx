import { useMemo, useState } from 'react';
import { CurationRow } from '../types/curation.types';
import { CurationRowItem } from './CurationRowItem';
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Layers, BookOpen, ExternalLink, FileText } from 'lucide-react';
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
      auto: rows.filter(r => r.auto_evaluated).length,
      lessons: new Set(rows.map(r => r.lesson_id)).size
    };
  }, [rows]);

  // 2. NEW: Group by Lesson Only (not by component)
  // Now each lesson has 1-2 sources that cover the entire lesson
  const groupedByLesson = useMemo(() => {
    const groups: Record<string, { title: string; sources: CurationRow[] }> = {};

    rows.forEach(row => {
      const lessonKey = row.lesson_id || 'unknown';
      const lessonTitle = row.lesson_title || lessonKey;

      if (!groups[lessonKey]) {
        groups[lessonKey] = { title: lessonTitle, sources: [] };
      }
      
      groups[lessonKey].sources.push(row);
    });

    // Sort sources by quality (notes may contain quality score)
    Object.values(groups).forEach(group => {
      group.sources.sort((a, b) => {
        // Prioritize apta sources
        if (a.apta && !b.apta) return -1;
        if (!a.apta && b.apta) return 1;
        return 0;
      });
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
        <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-[#6C757D] border border-dashed border-gray-300 dark:border-[#1E2329] rounded-xl bg-gray-50 dark:bg-[#0F1419]/50">
           <Layers className="mb-4 opacity-50" size={48} />
           <p className="text-lg font-medium text-gray-900 dark:text-[#E9ECEF]">No hay fuentes curadas aún.</p>
           <p className="text-sm">Inicia la curaduría para comenzar a buscar.</p>
        </div>
     );
  }

  return (
    <div className="space-y-6">
      
      {/* 1. Stats Bar - Simplified for Lesson-based view */}
      <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-white dark:bg-[#0F1419] border border-gray-200 dark:border-[#1E2329] shadow-sm">
         <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[#1F5AF6]/10 text-[#1F5AF6] border border-[#1F5AF6]/20">
            <BookOpen size={16} />
            <span className="font-bold">{stats.lessons}</span>
            <span className="text-xs opacity-80 uppercase tracking-wide">Lecciones</span>
         </div>
         <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[#00D4B3]/10 text-[#00D4B3] border border-[#00D4B3]/20">
            <CheckCircle2 size={16} />
            <span className="font-bold">{stats.apta}</span>
            <span className="text-xs opacity-80 uppercase tracking-wide">Fuentes Válidas</span>
         </div>
         <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-rose-500/10 text-rose-500 dark:text-rose-400 border border-rose-500/20">
            <XCircle size={16} />
            <span className="font-bold">{stats.rejected}</span>
            <span className="text-xs opacity-80 uppercase tracking-wide">Inválidas</span>
         </div>
         
         <div className="ml-auto text-xs text-gray-500 dark:text-[#6C757D] flex items-center gap-2">
            <span>{stats.auto} auto-validadas</span>
            <div className="h-4 w-px bg-gray-200 dark:bg-[#1E2329] mx-2" />
            <span>Total: {stats.total} fuentes</span>
         </div>
      </div>

      {isGenerating && stats.total === 0 && (
         <div className="p-8 text-center animate-pulse text-[#00D4B3]">
            <p>Investigando fuentes para cada lección...</p>
            <p className="text-xs text-gray-500 dark:text-[#6C757D] mt-2">Búsqueda profunda en progreso (1-2 fuentes por lección).</p>
         </div>
      )}

      {/* 2. Lesson List - Clean, Card-based Design */}
      <div className="space-y-3">
        {Object.entries(groupedByLesson).map(([lessonId, { title, sources }]) => {
          const isCollapsed = collapsedLessons[lessonId];
          
          // Lesson stats
          const validSources = sources.filter(s => s.apta === true).length;
          const totalSources = sources.length;
          const isComplete = validSources > 0;

          return (
            <div key={lessonId} className="border border-gray-200 dark:border-[#1E2329] rounded-xl overflow-hidden bg-white dark:bg-[#0F1419]">
              {/* Lesson Header */}
              <button 
                 onClick={() => toggleLesson(lessonId)}
                 className="w-full flex items-center gap-3 p-4 bg-white dark:bg-[#0F1419] hover:bg-gray-50 dark:hover:bg-[#1E2329]/50 transition-colors text-left group"
              >
                 {isCollapsed ? (
                    <ChevronRight size={18} className="text-gray-400 dark:text-[#6C757D] group-hover:text-gray-900 dark:group-hover:text-white transition-colors" />
                 ) : (
                    <ChevronDown size={18} className="text-gray-400 dark:text-[#6C757D] group-hover:text-gray-900 dark:group-hover:text-white transition-colors" />
                 )}
                 
                 <div className="flex-1 min-w-0">
                    <h3 className={`font-semibold text-base truncate ${isComplete ? 'text-[#00D4B3]' : 'text-gray-900 dark:text-[#E9ECEF]'}`}>
                       {title}
                    </h3>
                 </div>

                 {/* Source count badge */}
                 <div className={`flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded border
                    ${isComplete 
                      ? 'text-[#00D4B3] bg-[#00D4B3]/10 border-[#00D4B3]/20' 
                      : 'text-gray-500 dark:text-[#6C757D] bg-gray-100 dark:bg-[#151A21] border-gray-200 dark:border-[#1E2329]'
                    }`}
                 >
                    <FileText size={12} />
                    {validSources} / {totalSources}
                 </div>
              </button>

              {/* Sources List */}
              <AnimatePresence>
                 {!isCollapsed && (
                    <motion.div 
                      key="content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-gray-200 dark:border-[#1E2329]"
                    >
                       <div className="p-4 space-y-3">
                          {sources.length === 0 ? (
                            <p className="text-gray-500 dark:text-[#6C757D] text-sm italic">No se encontraron fuentes para esta lección.</p>
                          ) : (
                            sources.map((source, idx) => (
                              <LessonSourceCard 
                                key={source.id} 
                                source={source} 
                                index={idx + 1}
                                onUpdate={onUpdateRow}
                              />
                            ))
                          )}
                       </div>
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

// NEW: Simplified Source Card for Lesson-based view
interface LessonSourceCardProps {
  source: CurationRow;
  index: number;
  onUpdate: (id: string, updates: Partial<CurationRow>) => void;
}

function LessonSourceCard({ source, index, onUpdate }: LessonSourceCardProps) {
  const isValid = source.apta === true;
  const isInvalid = source.apta === false;
  const isPending = source.apta === null;

  const statusColor = isValid 
    ? 'border-[#00D4B3]/30 bg-[#00D4B3]/5' 
    : isInvalid 
      ? 'border-rose-500/30 bg-rose-500/5' 
      : 'border-gray-200 dark:border-[#1E2329] bg-white dark:bg-[#151A21]';

  const handleToggleApta = () => {
    // Cycle: null -> true -> false -> true
    const newValue = source.apta === null ? true : source.apta === true ? false : true;
    onUpdate(source.id, { apta: newValue });
  };

  return (
    <div className={`p-4 rounded-xl border ${statusColor} transition-all hover:border-[#00D4B3]/50`}>
      <div className="flex items-start gap-3">
        {/* Index Number */}
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
          ${isValid ? 'bg-[#00D4B3] text-[#0A2540]' : isInvalid ? 'bg-rose-500 text-white' : 'bg-gray-200 dark:bg-[#1E2329] text-gray-600 dark:text-[#6C757D]'}`}
        >
          {index}
        </div>

        {/* Source Content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Title & Link */}
          <div className="flex items-start gap-2">
            <h4 className="text-gray-900 dark:text-white font-medium text-sm leading-tight flex-1">
              {source.source_title || 'Fuente sin título'}
            </h4>
            {source.source_ref && (
              <a 
                href={source.source_ref} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[#1F5AF6] hover:text-[#1F5AF6]/80 transition-colors flex-shrink-0"
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>

          {/* URL Preview */}
          {source.source_ref && (
            <p className="text-gray-500 dark:text-[#6C757D] text-xs truncate font-mono">
              {source.source_ref}
            </p>
          )}

          {/* Rationale */}
          {source.source_rationale && (
            <p className="text-gray-600 dark:text-[#94A3B8] text-xs leading-relaxed">
              {source.source_rationale}
            </p>
          )}

          {/* Tags/Notes */}
          {source.notes && (
            <div className="flex flex-wrap gap-1 mt-2">
              <span className="text-[10px] bg-gray-100 dark:bg-[#1E2329] text-gray-600 dark:text-[#6C757D] px-2 py-0.5 rounded">
                {source.notes}
              </span>
            </div>
          )}

          {/* Auto-evaluation badge */}
          {source.auto_evaluated && source.auto_reason && (
            <span className="inline-flex items-center gap-1 text-[10px] text-[#00D4B3] bg-[#00D4B3]/10 px-2 py-0.5 rounded border border-[#00D4B3]/20">
              <CheckCircle2 size={10} />
              {source.auto_reason.length > 40 ? source.auto_reason.substring(0, 40) + '...' : source.auto_reason}
            </span>
          )}
        </div>

        {/* Status Toggle Button */}
        <button
          onClick={handleToggleApta}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
            ${isValid 
              ? 'bg-[#00D4B3]/20 text-[#00D4B3] border border-[#00D4B3]/30 hover:bg-[#00D4B3]/30' 
              : isInvalid 
                ? 'bg-rose-500/20 text-rose-500 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-500/30' 
                : 'bg-gray-100 dark:bg-[#1E2329] text-gray-500 dark:text-[#6C757D] border border-gray-200 dark:border-[#1E2329] hover:border-[#00D4B3]/50 hover:text-gray-900 dark:hover:text-white'
            }`}
        >
          {isValid ? 'Válida' : isInvalid ? 'Inválida' : 'Pendiente'}
        </button>
      </div>
    </div>
  );
}

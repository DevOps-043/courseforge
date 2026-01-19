import { useState } from 'react';
import { CurationRow } from '../types/curation.types';
import { ExternalLink, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface CurationRowItemProps {
  row: CurationRow;
  onUpdate: (id: string, updates: Partial<CurationRow>) => void;
}

export function CurationRowItem({ row, onUpdate }: CurationRowItemProps) {
  const [isExpanded, setIsExpanded] = useState(true); // Default expanded as per image
  const isApta = row.apta === true;
  const isRejected = row.apta === false;
  
  // Cobertura mapping (assuming row has this field, otherwise default false)
  // Casting to any because strict type might differ slightly in naming conventions if not updated recently
  const hasFullCoverage = (row as any).cobertura_completa === true;

  return (
    <motion.div 
      layout
      transition={{ duration: 0.2 }}
      className={`
      group flex flex-col rounded-xl border transition-all duration-300 overflow-hidden
      ${isApta 
        ? 'bg-[#0F1419] border-[#00D4B3]/50 shadow-[0_0_15px_-3px_rgba(0,212,179,0.15)] ring-1 ring-[#00D4B3]/20' 
        : isRejected 
          ? 'bg-[#0F1419] border-rose-500/30 opacity-80 hover:opacity-100 ring-1 ring-rose-500/10' 
          : 'bg-[#0F1419] border-[#1E2329] hover:border-[#6C757D]'
      }
    `}>
      {/* Header Section (Always Visible) */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-4 flex items-start gap-4 cursor-pointer select-none"
      >
        {/* Status Indicator Dot with Pulse Animation */}
        <div className="mt-1.5 relative">
            <div className={`w-2 h-2 rounded-full shrink-0 ${isApta ? 'bg-[#00D4B3] shadow-[0_0_8px_#00D4B3]' : isRejected ? 'bg-rose-500' : 'bg-amber-400'}`} />
            {isApta && (
                <span className="absolute -inset-1 rounded-full bg-[#00D4B3] opacity-20 animate-ping" />
            )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-1">
           {/* Title Row */}
           <div className="flex items-center justify-between gap-4">
               <h4 className={`text-base font-medium truncate pr-2 ${isApta ? 'text-white' : 'text-[#E9ECEF]'}`} title={row.source_title || 'Sin Título'}>
                 {row.source_title || 'Fuente Detectada'}
               </h4>
               <div className="flex items-center gap-2 shrink-0">
                  {/* Category Badge */}
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#151A21] text-[#6C757D] border border-[#1E2329]">
                    {row.component}
                  </span>
                  
                  {/* Critical Badge */}
                  {row.is_critical && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20">
                      Critico
                    </span>
                  )}

                  {/* Accessible Badge (200 OK) */}
                  {row.http_status_code === 200 && (
                     <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#00D4B3]/10 text-[#00D4B3] border border-[#00D4B3]/20">
                       Accesible
                     </span>
                  )}
                  
                  <button className="text-[#6C757D] hover:text-white transition-colors p-1">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
               </div>
           </div>

           {/* URL Preview - Clickable */}
           {row.source_ref && (
               <a 
                 href={row.source_ref}
                 target="_blank" 
                 rel="noopener noreferrer"
                 onClick={(e) => e.stopPropagation()} // Prevent row toggle
                 className="flex items-center gap-2 text-xs text-[#6C757D] font-mono hover:text-[#00D4B3] hover:underline transition-colors w-fit group/link"
               >
                  <ExternalLink size={10} className="group-hover/link:stroke-[#00D4B3]" />
                  <span className="truncate max-w-md">{row.source_ref}</span>
               </a>
           )}
        </div>
      </div>

      {/* Expanded Content Body */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-[#1E2329] bg-[#151A21]/30"
          >
            <div className="p-4 pt-4 space-y-6">
                
                {/* Rationale Text */}
                <div className="pl-6 border-l-2 border-[#1E2329]">
                    <p className="text-sm text-[#94A3B8] leading-relaxed font-light">
                       {row.source_rationale || 'Sin justificación disponible.'}
                    </p>
                </div>

                {/* Minimalist Action Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column: Toggles */}
                    <div className="space-y-4">
                        {/* Apta Toggle */}
                        <div className="flex items-center gap-4">
                            <span className="text-xs font-medium text-[#6C757D] w-20">Apta:</span>
                            <div className="flex bg-[#0A0D12] rounded-lg p-1 border border-[#1E2329]">
                                <button 
                                   onClick={() => onUpdate(row.id, { apta: true, cobertura_completa: true, motivo_no_apta: null })}
                                   className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${isApta ? 'bg-[#00D4B3]/10 text-[#00D4B3] border border-[#00D4B3]/20 shadow-sm' : 'text-[#6C757D] hover:text-white'}`}
                                >
                                   <div className="flex items-center gap-1.5">
                                      {isApta && <CheckCircle2 size={12} />}
                                      Sí
                                   </div>
                                </button>
                                <button 
                                   onClick={() => onUpdate(row.id, { apta: false, cobertura_completa: false, motivo_no_apta: 'Rechazo manual' })}
                                   className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${isRejected ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-sm' : 'text-[#6C757D] hover:text-white'}`}
                                >
                                    <div className="flex items-center gap-1.5">
                                      {isRejected && <XCircle size={12} />}
                                      No
                                   </div>
                                </button>
                            </div>
                        </div>

                        {/* Cobertura Toggle (Disabled if Rejected) */}
                        <div className={`flex items-center gap-4 transition-opacity duration-200 ${!isApta ? 'opacity-40 grayscale pointer-events-none' : 'opacity-100'}`}>
                            <span className="text-xs font-medium text-[#6C757D] w-20">Cobertura:</span>
                            <div className="flex bg-[#0A0D12] rounded-lg p-1 border border-[#1E2329]">
                                <button 
                                   disabled={!isApta}
                                   onClick={() => onUpdate(row.id, { cobertura_completa: true } as any)}
                                   className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${hasFullCoverage ? 'bg-[#1E2329] text-white border border-[#3F3F46]' : 'text-[#6C757D] hover:text-white'}`}
                                >
                                   Completa
                                </button>
                                <button 
                                   disabled={!isApta}
                                   onClick={() => onUpdate(row.id, { cobertura_completa: false } as any)}
                                   className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${!hasFullCoverage ? 'bg-[#1E2329] text-white border border-[#3F3F46]' : 'text-[#6C757D] hover:text-white'}`}
                                >
                                   Parcial
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Notes */}
                    <div className="space-y-2">
                        <label className={`text-xs font-medium flex items-center gap-2 ${isRejected ? 'text-rose-400' : 'text-[#6C757D]'}`}>
                           {isRejected ? 'Razón del rechazo (Requerido):' : 'Notas (opcional):'}
                        </label>
                        <textarea 
                           className={`w-full h-20 bg-[#0A0D12] border rounded-lg p-3 text-xs focus:ring-0 outline-none resize-none transition-colors 
                             ${isRejected 
                               ? 'border-rose-500/30 focus:border-rose-500 text-rose-200 placeholder:text-rose-500/30' 
                               : 'border-[#1E2329] text-[#94A3B8] focus:border-[#6C757D] placeholder:text-[#2A303C]'
                             }`}
                           placeholder={isRejected ? "Explique por qué esta fuente no es apta..." : "Escribe una observación sobre esta fuente..."}
                           defaultValue={row.notes || ''}
                           onBlur={(e) => onUpdate(row.id, { notes: e.target.value })}
                        />
                    </div>
                </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

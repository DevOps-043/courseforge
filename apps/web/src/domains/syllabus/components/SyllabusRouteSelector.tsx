
import { Esp02Route } from '../../types/syllabus.types';

interface SyllabusRouteSelectorProps {
  selectedRoute: Esp02Route | null;
  onSelect: (route: Esp02Route) => void;
  disabled?: boolean;
}

export function SyllabusRouteSelector({ selectedRoute, onSelect, disabled = false }: SyllabusRouteSelectorProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Opción B: IA Generativa */}
      <div 
        onClick={() => !disabled && onSelect('B_NO_SOURCE')}
        className={`
          cursor-pointer relative rounded-xl border-2 p-5 transition-all duration-300 group
          ${selectedRoute === 'B_NO_SOURCE' 
            ? 'border-[#00D4B3] bg-[#00D4B3]/5 dark:bg-[#00D4B3]/10 ring-1 ring-[#00D4B3]' 
            : 'border-gray-200 dark:border-white/10 bg-white dark:bg-[#1E2329] hover:border-[#00D4B3]/50 hover:bg-gray-50 dark:hover:bg-white/5'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <div className="flex items-start justify-between mb-3">
          <div className={`
            p-2.5 rounded-lg transition-colors
            ${selectedRoute === 'B_NO_SOURCE' 
              ? 'bg-[#00D4B3] text-[#0A2540]' 
              : 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 group-hover:text-[#00D4B3]'}
          `}>
            {/* Sparkles Icon */}
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          
          {selectedRoute === 'B_NO_SOURCE' && (
            <div className="animate-in zoom-in duration-200">
               <svg className="w-6 h-6 text-[#00D4B3]" fill="currentColor" viewBox="0 0 20 20">
                 <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
               </svg>
            </div>
          )}
        </div>

        <h3 className="text-base font-bold text-[#0A2540] dark:text-white mb-2">IA Generativa</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
          La IA crea el temario usando conocimiento general del tema. Ideal para generación rápida basada en objetivos.
        </p>

        <ul className="space-y-2">
          <li className="flex items-center gap-2 text-xs font-medium text-[#00D4B3]">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            Generación rápida
          </li>
          <li className="flex items-center gap-2 text-xs font-medium text-[#00D4B3]">
             <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            Basado en objetivos
          </li>
        </ul>
      </div>

      {/* Opción A: Documentos */}
      <div 
        onClick={() => !disabled && onSelect('A_WITH_SOURCE')}
        className={`
          cursor-pointer relative rounded-xl border-2 p-5 transition-all duration-300 group
          ${selectedRoute === 'A_WITH_SOURCE' 
            ? 'border-[#00D4B3] bg-[#00D4B3]/5 dark:bg-[#00D4B3]/10 ring-1 ring-[#00D4B3]' 
            : 'border-gray-200 dark:border-white/10 bg-white dark:bg-[#1E2329] hover:border-[#00D4B3]/50 hover:bg-gray-50 dark:hover:bg-white/5'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <div className="flex items-start justify-between mb-3">
          <div className={`
            p-2.5 rounded-lg transition-colors
            ${selectedRoute === 'A_WITH_SOURCE' 
              ? 'bg-[#00D4B3] text-[#0A2540]' 
              : 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 group-hover:text-[#00D4B3]'}
          `}>
            {/* Document Icon */}
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          
          {selectedRoute === 'A_WITH_SOURCE' && (
            <div className="animate-in zoom-in duration-200">
               <svg className="w-6 h-6 text-[#00D4B3]" fill="currentColor" viewBox="0 0 20 20">
                 <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
               </svg>
            </div>
          )}
        </div>

        <h3 className="text-base font-bold text-[#0A2540] dark:text-white mb-2">Basado en Documentos</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
          Extrae la estructura de tus materiales existentes (PDF, DOC). La IA se adhiere a tu contenido.
        </p>

        <ul className="space-y-2">
           <li className="flex items-center gap-2 text-xs font-medium text-[#00D4B3]">
             <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            PDF, DOC, PPT
          </li>
          <li className="flex items-center gap-2 text-xs font-medium text-[#00D4B3]">
             <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            Mayor fidelidad
          </li>
        </ul>
      </div>
    </div>
  );
}

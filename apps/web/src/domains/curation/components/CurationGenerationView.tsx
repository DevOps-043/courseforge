"use client";

import {
  BookOpen,
  Library,
  Loader2,
  Pause,
  RefreshCw,
  Square,
} from "lucide-react";
import { motion } from "framer-motion";
import { CURATION_STATES } from "@/lib/pipeline-constants";

interface CurationGenerationViewProps {
  curationState?: string | null;
  progress: number;
  rowsCount: number;
  onPause: () => void;
  onRefresh: () => void;
  onStop: () => void;
}

export function CurationGenerationView({
  curationState,
  progress,
  rowsCount,
  onPause,
  onRefresh,
  onStop,
}: CurationGenerationViewProps) {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in duration-700">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#0A2540] border border-[#00D4B3]/20 text-[#00D4B3]">
            <BookOpen size={24} />
          </div>
          Paso 4: Curaduria de Fuentes (Fase 2)
        </h2>
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-[#1E2329] bg-[#0F1419] shadow-2xl p-12 min-h-[500px] flex flex-col items-center justify-center group ring-1 ring-[#00D4B3]/10">
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5 mix-blend-overlay" />
        <div className="absolute top-[-50%] left-[-20%] w-[800px] h-[800px] bg-[#00D4B3]/5 rounded-full blur-[120px] animate-pulse-slow opacity-30" />

        <div className="relative z-10 flex flex-col items-center max-w-xl w-full text-center space-y-12">
          <div className="relative w-32 h-32 flex items-center justify-center">
            <div className="absolute inset-0 animate-[spin_4s_linear_infinite]">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 bg-[#00D4B3] rounded-full shadow-[0_0_8px_#00D4B3]" />
            </div>
            <div className="absolute inset-4 animate-[spin_6s_linear_infinite_reverse]">
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 w-1.5 h-1.5 bg-[#1F5AF6] rounded-full" />
            </div>

            <div className="relative w-16 h-16 bg-[#151A21] border border-[#1E2329] rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(0,212,179,0.05)] z-10">
              <Library size={28} className="text-[#00D4B3]" />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-3xl font-bold text-white tracking-tight">
              Buscando Fuentes
            </h3>
            <div className="flex flex-col gap-2">
              <p className="text-[#94A3B8] text-base leading-relaxed max-w-sm mx-auto font-light">
                Investigando fuentes de alta calidad para cada leccion del curso.
              </p>
              {rowsCount > 0 && (
                <span className="text-xs font-mono text-[#00D4B3] bg-[#00D4B3]/10 px-2 py-1 rounded-md mx-auto border border-[#00D4B3]/20">
                  {rowsCount} fuentes encontradas hasta ahora
                </span>
              )}
            </div>
          </div>

          <div className="w-full max-w-md space-y-3">
            <div className="flex justify-between items-end px-1">
              <span className="text-[10px] font-bold tracking-widest uppercase text-[#6C757D]">
                Estado del Agente
              </span>
              <span className="text-xs font-mono font-medium text-[#00D4B3] flex items-center gap-2">
                {progress < 30
                  ? "Iniciando..."
                  : progress < 60
                    ? "Analizando..."
                    : "Finalizando..."}
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

          <div className="flex flex-col gap-6 items-center w-full max-w-xs">
            <div className="flex items-center gap-2 px-4 py-2 bg-[#151A21]/80 rounded-full border border-[#00D4B3]/20 backdrop-blur-sm">
              <Loader2 size={12} className="text-[#00D4B3] animate-spin" />
              <span className="text-[10px] text-[#00D4B3] font-medium tracking-wide uppercase">
                Auto-Refresh Activo
              </span>
            </div>

            <button
              onClick={onRefresh}
              className="w-full py-3 px-4 rounded-xl border border-[#6C757D]/30 text-[#94A3B8] hover:text-white hover:border-[#00D4B3] hover:bg-[#00D4B3]/5 transition-all duration-300 flex items-center justify-center gap-2 group"
            >
              <RefreshCw
                size={14}
                className="group-hover:rotate-180 transition-transform duration-500"
              />
              <span className="text-xs font-medium uppercase tracking-wide">
                Actualizar Progreso Manualmente
              </span>
            </button>
          </div>

          <div className="flex gap-4 items-center">
            <button
              onClick={onPause}
              disabled={
                curationState === CURATION_STATES.PAUSED_REQUESTED ||
                curationState === CURATION_STATES.STOPPED_REQUESTED
              }
              className="flex items-center gap-2 px-4 py-2 bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/20 rounded-lg hover:bg-[#F59E0B]/20 transition-colors disabled:opacity-50"
            >
              <Pause size={16} />
              {curationState === CURATION_STATES.PAUSED_REQUESTED
                ? "Pausando..."
                : "Pausar"}
            </button>
            <button
              onClick={onStop}
              disabled={curationState === CURATION_STATES.PAUSED_REQUESTED}
              className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors disabled:opacity-50
                ${
                  curationState === CURATION_STATES.STOPPED_REQUESTED
                    ? "bg-[#EF4444]/20 text-[#EF4444] border-[#EF4444] font-bold animate-pulse"
                    : "bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20 hover:bg-[#EF4444]/20"
                }`}
            >
              <Square size={16} />
              {curationState === CURATION_STATES.STOPPED_REQUESTED
                ? "Forzar Detencion"
                : "Detener"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import {
  AlertCircle,
  CheckCircle2,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";
import { DEFAULT_PROMPT_PREVIEW } from "../lib/curation-ui";

interface CurationSetupModule {
  lessons: unknown[];
}

interface CurationSetupViewProps {
  onGenerate: () => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  onUseOwnSources: () => Promise<void> | void;
  temario?: CurationSetupModule[];
}

export function CurationSetupView({
  onGenerate,
  onRefresh,
  onUseOwnSources,
  temario,
}: CurationSetupViewProps) {
  const hasTemario = Boolean(temario && temario.length > 0);
  const lessonsCount =
    temario?.reduce((acc, module) => acc + module.lessons.length, 0) ?? 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#1F5AF6]/10 text-[#1F5AF6]">
            <Sparkles size={24} />
          </div>
          Paso 4: Curaduria de Fuentes (Fase 2)
        </h2>
        <p className="text-gray-500 dark:text-[#94A3B8] text-base leading-relaxed max-w-2xl ml-12">
          OpenAI propone candidatos y Courseforge valida acceso, contenido y
          calidad. Tambien puedes trabajar solo con URLs y PDFs propios.
        </p>
      </div>

      <div className="bg-gradient-to-br from-[#1F5AF6]/5 via-[#00D4B3]/5 to-[#1F5AF6]/5 dark:from-[#1F5AF6]/10 dark:via-[#00D4B3]/10 dark:to-[#1F5AF6]/10 border border-[#1F5AF6]/20 dark:border-[#1F5AF6]/30 rounded-2xl p-8 shadow-xl shadow-[#1F5AF6]/5 dark:shadow-black/20 transition-all duration-300 relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-[#1F5AF6]/20 text-[#1F5AF6]">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="text-gray-900 dark:text-white font-bold text-lg">
                Busqueda automatica interna
              </h3>
              <span className="text-[10px] bg-[#1F5AF6]/20 text-[#1F5AF6] px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                OpenAI
              </span>
            </div>
          </div>

          <p className="text-gray-600 dark:text-[#94A3B8] text-sm leading-relaxed mb-6 max-w-lg">
            SofLIA Engine investigara fuentes recientes por leccion, validara
            que las URLs existan y dejara los resultados listos para revision QA.
          </p>

          <div className="flex flex-wrap gap-3 mb-6">
            {[
              "Web search",
              "JSON estructurado",
              "Validacion URL",
              "URLs y PDFs propios",
              "Revision humana",
            ].map((tag) => (
              <span
                key={tag}
                className="text-[10px] bg-white dark:bg-[#151A21] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-full font-medium flex items-center gap-1.5"
              >
                <CheckCircle2 size={10} className="text-[#00D4B3]" />
                {tag}
              </span>
            ))}
          </div>

          <div className="mb-6 bg-white/70 dark:bg-[#0F1419]/70 border border-gray-200 dark:border-[#6C757D]/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Settings2 size={14} className="text-[#00D4B3]" />
              <h4 className="text-gray-700 dark:text-gray-300 font-medium text-sm">
                Criterios de busqueda
              </h4>
            </div>
            <p className="text-gray-600 dark:text-[#94A3B8] text-sm leading-relaxed">
              {DEFAULT_PROMPT_PREVIEW}
            </p>
          </div>

          <button
            onClick={onGenerate}
            disabled={!hasTemario}
            className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all relative overflow-hidden ${
              hasTemario
                ? "bg-[#00D4B3] hover:bg-[#00bda0] text-[#0A2540] shadow-lg shadow-[#00D4B3]/25 hover:shadow-[#00D4B3]/40 hover:-translate-y-0.5"
                : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
            }`}
          >
            <Play size={20} fill="currentColor" />
            Iniciar curaduria automatica
          </button>
          <button
            type="button"
            onClick={onUseOwnSources}
            disabled={!hasTemario}
            className="mt-3 w-full border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-[#1F5AF6]/50 hover:text-[#1F5AF6] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#334155] dark:bg-[#10151A] dark:text-gray-300"
          >
            Usar solo fuentes propias
          </button>

          <div className="mt-6 flex flex-col justify-center items-center gap-3 border-t border-[#1F5AF6]/10 pt-6">
            <p className="text-gray-600 dark:text-[#94A3B8] text-sm text-center font-medium">
              Ya hay un proceso en curso o quieres verificar resultados?
            </p>
            <button
              onClick={onRefresh}
              className="px-6 py-2.5 bg-white dark:bg-[#10151A] border border-gray-200 dark:border-[#334155] text-gray-700 dark:text-gray-300 rounded-xl shadow-sm hover:border-[#1F5AF6]/50 hover:text-[#1F5AF6] dark:hover:text-[#1F5AF6] transition-all flex items-center justify-center gap-2 group"
            >
              <RefreshCw
                size={16}
                className="group-hover:rotate-180 transition-transform duration-500"
              />
              Actualizar y ver resultados
            </button>
          </div>

          {!hasTemario && (
            <p className="text-center text-amber-500 text-xs mt-3 flex items-center justify-center gap-1">
              <AlertCircle size={12} />
              Necesitas completar el temario primero (Paso 2)
            </p>
          )}

          {hasTemario && (
            <p className="text-center text-gray-500 dark:text-[#6C757D] text-xs mt-3">
              Se procesaran {lessonsCount} lecciones en lotes controlados.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

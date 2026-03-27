"use client";

import { BookOpen, CheckCircle2, Play, Settings2 } from "lucide-react";
import { DEFAULT_PROMPT_PREVIEW } from "./plan-component-config";

interface InstructionalPlanSetupViewProps {
  customPrompt: string;
  isGenerating: boolean;
  lessonCount?: number;
  onGenerate: () => Promise<void> | void;
  setCustomPrompt: (value: string) => void;
  setUseCustomPrompt: (value: boolean) => void;
  useCustomPrompt: boolean;
}

export function InstructionalPlanSetupView({
  customPrompt,
  isGenerating,
  lessonCount,
  onGenerate,
  setCustomPrompt,
  setUseCustomPrompt,
  useCustomPrompt,
}: InstructionalPlanSetupViewProps) {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#00D4B3]/10 text-[#00D4B3]">
            <BookOpen size={24} />
          </div>
          Paso 3: Plan Instruccional
        </h2>
        <p className="text-[#94A3B8] text-base leading-relaxed max-w-2xl ml-12">
          La IA generará el plan instruccional detallado para cada lección,
          definiendo actividades, recursos y evaluaciones validadas
          pedagógicamente.
        </p>
      </div>

      <div className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl p-6 shadow-xl shadow-black/20 transition-all duration-300">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-white font-semibold text-sm uppercase tracking-wider flex items-center gap-2">
            <Settings2 size={16} className="text-[#00D4B3]" />
            Versión del Prompt
          </h3>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium transition-colors ${
                useCustomPrompt ? "text-[#00D4B3]" : "text-[#6C757D]"
              }`}
            >
              Prompt personalizado
            </span>
            <button
              onClick={() => setUseCustomPrompt(!useCustomPrompt)}
              className={`w-10 h-5 rounded-full relative border transition-all duration-300 focus:outline-none ${
                useCustomPrompt
                  ? "bg-[#00D4B3]/20 border-[#00D4B3]"
                  : "bg-[#0F1419] border-[#6C757D]/20"
              }`}
            >
              <div
                className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 shadow-sm ${
                  useCustomPrompt
                    ? "left-5 bg-[#00D4B3]"
                    : "left-0.5 bg-[#6C757D]"
                }`}
              />
            </button>
          </div>
        </div>

        {useCustomPrompt ? (
          <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-xs text-gray-400 font-medium">
                Instrucciones del Sistema para la IA
              </label>
              <span className="text-[10px] text-[#00D4B3] bg-[#00D4B3]/10 px-2 py-0.5 rounded border border-[#00D4B3]/20">
                Modo Edición
              </span>
            </div>
            <textarea
              value={customPrompt}
              onChange={(event) => setCustomPrompt(event.target.value)}
              className="w-full h-48 bg-[#0F1419] border border-[#00D4B3]/30 rounded-xl p-4 text-sm text-gray-300 font-mono leading-relaxed focus:outline-none focus:border-[#00D4B3] transition-colors resize-none shadow-inner placeholder:text-gray-600"
              placeholder={DEFAULT_PROMPT_PREVIEW}
            />
            <p className="text-xs text-gray-500">
              <span className="text-[#00D4B3]">*</span> Asegúrate de solicitar
              una respuesta en formato JSON estrictamente válido.
            </p>
          </div>
        ) : (
          <div className="bg-[#0F1419] border border-[#6C757D]/10 rounded-xl p-6 flex flex-col gap-4 hover:border-[#00D4B3]/20 transition-colors relative overflow-hidden">
            <div className="flex items-center gap-3 relative z-10">
              <CheckCircle2 size={18} className="text-[#00D4B3]" />
              <h4 className="text-[#00D4B3] font-bold text-sm">
                Configuración Optimizada
              </h4>
            </div>
            <p className="text-[#94A3B8] text-sm leading-relaxed relative z-10">
              Prompt optimizado para generar lecciones detalladas alineadas con
              el temario aprobado. Incluye la definición de objetivos de
              aprendizaje, criterios de éxito medibles y 4 componentes
              obligatorios por lección: Diálogo, Lectura, Quiz y Video.
            </p>
            <div className="flex flex-wrap gap-2 relative z-10 mt-2">
              {[
                "Estructura JSON",
                "Optimizado Gemini 2.0",
                "Validación Pedagógica",
                "Componentes Modulares",
              ].map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] bg-[#151A21] text-gray-400 border border-gray-700 px-2 py-1 rounded font-bold uppercase tracking-wider"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onGenerate}
        disabled={isGenerating}
        className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all relative overflow-hidden ${
          isGenerating
            ? "bg-[#00D4B3]/20 text-[#00D4B3] cursor-wait border border-[#00D4B3]/20"
            : "bg-[#00D4B3] hover:bg-[#00bda0] text-[#0A2540] shadow-lg shadow-[#00D4B3]/25 hover:shadow-[#00D4B3]/40 hover:-translate-y-0.5"
        }`}
      >
        {isGenerating ? (
          <>
            <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span>
              Generando Estructura Instruccional...
              {lessonCount ? ` (${lessonCount})` : ""}
            </span>
          </>
        ) : (
          <>
            <Play size={20} fill="currentColor" />
            Generar Plan Instruccional
          </>
        )}
      </button>

      <div className="text-center">
        <p className="text-[#6C757D] text-xs">
          La generación puede tomar entre 30 a 60 segundos.
        </p>
      </div>
    </div>
  );
}

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
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[var(--engine-accent)]/10 text-[var(--engine-accent)]">
            <BookOpen size={24} />
          </div>
          Paso 3: Plan Instruccional
        </h2>
        <p className="text-gray-500 dark:text-[var(--engine-text-muted)] text-base leading-relaxed max-w-2xl ml-12">
          La IA generará el plan instruccional detallado para cada lección,
          definiendo actividades, recursos y evaluaciones validadas
          pedagógicamente.
        </p>
      </div>

      <div className="bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-[var(--engine-muted)]/10 rounded-2xl p-6 shadow-xl shadow-black/10 dark:shadow-black/20 transition-all duration-300">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-gray-900 dark:text-white font-semibold text-sm uppercase tracking-wider flex items-center gap-2">
            <Settings2 size={16} className="text-[var(--engine-accent)]" />
            Versión del Prompt
          </h3>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium transition-colors ${
                useCustomPrompt ? "text-[var(--engine-accent)]" : "text-[var(--engine-muted)]"
              }`}
            >
              Prompt personalizado
            </span>
            <button
              onClick={() => setUseCustomPrompt(!useCustomPrompt)}
              className={`w-10 h-5 rounded-full relative border transition-all duration-300 focus:outline-none ${
                useCustomPrompt
                  ? "bg-[var(--engine-accent)]/20 border-[var(--engine-accent)]"
                  : "bg-gray-100 dark:bg-[var(--engine-canvas)] border-gray-300 dark:border-[var(--engine-muted)]/20"
              }`}
            >
              <div
                className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 shadow-sm ${
                  useCustomPrompt
                    ? "left-5 bg-[var(--engine-accent)]"
                    : "left-0.5 bg-[var(--engine-muted)]"
                }`}
              />
            </button>
          </div>
        </div>

        {useCustomPrompt ? (
          <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                Instrucciones del Sistema para la IA
              </label>
              <span className="text-[10px] text-[var(--engine-accent)] bg-[var(--engine-accent)]/10 px-2 py-0.5 rounded border border-[var(--engine-accent)]/20">
                Modo Edición
              </span>
            </div>
            <textarea
              value={customPrompt}
              onChange={(event) => setCustomPrompt(event.target.value)}
              className="w-full h-48 bg-gray-50 dark:bg-[var(--engine-canvas)] border border-[var(--engine-accent)]/30 rounded-xl p-4 text-sm text-gray-900 dark:text-gray-300 font-mono leading-relaxed focus:outline-none focus:border-[var(--engine-accent)] transition-colors resize-none shadow-inner placeholder:text-gray-400 dark:placeholder:text-gray-600"
              placeholder={DEFAULT_PROMPT_PREVIEW}
            />
            <p className="text-xs text-gray-500 dark:text-gray-500">
              <span className="text-[var(--engine-accent)]">*</span> Asegúrate de solicitar
              una respuesta en formato JSON estrictamente válido.
            </p>
          </div>
        ) : (
          <div className="bg-gray-50 dark:bg-[var(--engine-canvas)] border border-gray-200 dark:border-[var(--engine-muted)]/10 rounded-xl p-6 flex flex-col gap-4 hover:border-[var(--engine-accent)]/20 transition-colors relative overflow-hidden">
            <div className="flex items-center gap-3 relative z-10">
              <CheckCircle2 size={18} className="text-[var(--engine-accent)]" />
              <h4 className="text-[var(--engine-accent)] font-bold text-sm">
                Configuración Optimizada
              </h4>
            </div>
            <p className="text-gray-600 dark:text-[var(--engine-text-muted)] text-sm leading-relaxed relative z-10">
              Prompt optimizado para generar lecciones detalladas alineadas con
              el temario aprobado. Incluye la definición de objetivos de
              aprendizaje, criterios de éxito medibles y 4 componentes
              obligatorios por lección: Diálogo, Lectura, Quiz y Video.
            </p>
            <div className="flex flex-wrap gap-2 relative z-10 mt-2">
              {[
                "Estructura JSON",
                "Validación Pedagógica",
                "Componentes Modulares",
              ].map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] bg-white dark:bg-[var(--engine-surface-solid)] text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 px-2 py-1 rounded font-bold uppercase tracking-wider"
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
            ? "bg-[var(--engine-accent)]/20 text-[var(--engine-accent)] cursor-wait border border-[var(--engine-accent)]/20"
            : "bg-[var(--engine-accent)] hover:bg-[var(--engine-accent-hover)] text-[var(--engine-primary)] shadow-lg shadow-[var(--engine-accent)]/25 hover:shadow-[var(--engine-accent)]/40 hover:-translate-y-0.5"
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
        <p className="text-[var(--engine-muted)] text-xs">
          La generación puede tomar entre 30 a 60 segundos.
        </p>
      </div>
    </div>
  );
}

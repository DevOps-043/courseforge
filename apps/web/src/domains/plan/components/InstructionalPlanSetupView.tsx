"use client";

import { BookOpen, Play, RotateCcw, Settings2 } from "lucide-react";

interface InstructionalPlanSetupViewProps {
  configuredPrompt: string;
  customPrompt: string;
  isGenerating: boolean;
  lessonCount?: number;
  onGenerate: () => Promise<void> | void;
  promptSource: "organization" | "global" | "default" | null;
  promptVersion: string | null;
  setCustomPrompt: (value: string) => void;
  setUseCustomPrompt: (value: boolean) => void;
  useCustomPrompt: boolean;
}

export function InstructionalPlanSetupView({
  configuredPrompt,
  customPrompt,
  isGenerating,
  lessonCount,
  onGenerate,
  promptSource,
  promptVersion,
  setCustomPrompt,
  setUseCustomPrompt,
  useCustomPrompt,
}: InstructionalPlanSetupViewProps) {
  const promptWasModified = customPrompt.trim() !== configuredPrompt.trim();
  const promptSourceLabel = promptSource === "organization"
    ? "Configuración de la empresa"
    : promptSource === "global"
      ? "Configuración global"
      : "Prompt predeterminado";
  const canGenerate = !isGenerating && (!useCustomPrompt || Boolean(customPrompt.trim()));

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
              type="button"
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

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Prompt configurado para generar el plan
              </label>
              <span className="rounded border border-[var(--engine-accent)]/20 bg-[var(--engine-accent)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--engine-accent)]">
                {useCustomPrompt
                  ? promptWasModified
                    ? "Modificado para esta generación"
                    : "Modo edición"
                  : promptSourceLabel}
              </span>
            </div>

            {useCustomPrompt && promptWasModified ? (
              <button
                type="button"
                onClick={() => setCustomPrompt(configuredPrompt)}
                className="flex items-center gap-1.5 text-xs font-semibold text-[var(--engine-accent)] hover:underline"
              >
                <RotateCcw size={13} />
                Restaurar configurado
              </button>
            ) : null}
          </div>

          <textarea
            value={customPrompt}
            onChange={(event) => setCustomPrompt(event.target.value)}
            readOnly={!useCustomPrompt}
            maxLength={40_000}
            className={`h-64 w-full rounded-xl border p-4 font-mono text-sm leading-relaxed shadow-inner outline-none transition-colors resize-y ${
              useCustomPrompt
                ? "border-[var(--engine-accent)]/30 bg-gray-50 text-gray-900 focus:border-[var(--engine-accent)] dark:bg-[var(--engine-canvas)] dark:text-gray-300"
                : "cursor-default border-gray-200 bg-gray-50 text-gray-600 dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-canvas)] dark:text-gray-400"
            }`}
            aria-label="Prompt configurado para generar el plan instruccional"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-500">
            <span>
              {useCustomPrompt
                ? "La modificación se aplicará solo a esta generación."
                : "Activa Prompt personalizado para editar este contenido."}
            </span>
            <span>
              {customPrompt.length.toLocaleString("es-MX")} / 40,000 caracteres
              {promptVersion ? ` · versión ${promptVersion}` : ""}
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            Variables disponibles: {"${courseName}"}, {"${ideaCentral}"}, {"${currentModule}"}, {"${lessonCount}"} y {"${lessonsText}"}. Las reglas técnicas del sistema y el contrato JSON se aplican por separado.
          </p>
        </div>
      </div>

      <button
        onClick={onGenerate}
        disabled={!canGenerate}
        className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all relative overflow-hidden ${
          !canGenerate
            ? `bg-[var(--engine-accent)]/20 text-[var(--engine-accent)] border border-[var(--engine-accent)]/20 ${
                isGenerating ? "cursor-wait" : "cursor-not-allowed"
              }`
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

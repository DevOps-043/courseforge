"use client";

import { useState } from "react";

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
  onGenerate: (promptOverride?: string) => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  configuredPrompt?: string;
  temario?: CurationSetupModule[];
  lessonRequirements?: Array<{
    id: string;
    title: string;
    requiredSources: number;
    videoTargetSeconds: number;
  }>;
}

export function CurationSetupView({
  onGenerate,
  onRefresh,
  configuredPrompt = DEFAULT_PROMPT_PREVIEW,
  lessonRequirements = [],
  temario,
}: CurationSetupViewProps) {
  const [prompt, setPrompt] = useState(configuredPrompt);

  const hasTemario = Boolean(temario && temario.length > 0);
  const lessonsCount =
    temario?.reduce((acc, module) => acc + module.lessons.length, 0) ?? 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[var(--engine-info)]/10 text-[var(--engine-info)]">
            <Sparkles size={24} />
          </div>
          Paso 4: Curaduria de Fuentes
        </h2>
        <p className="text-gray-500 dark:text-[var(--engine-text-muted)] text-base leading-relaxed max-w-2xl ml-12">
          GPT busca fuentes web y SofLIA - Engine valida automaticamente su
          acceso, contenido y calidad hasta completar cada leccion.
        </p>
      </div>

      <div className="bg-gradient-to-br from-[var(--engine-info)]/5 via-[var(--engine-accent)]/5 to-[var(--engine-info)]/5 dark:from-[var(--engine-info)]/10 dark:via-[var(--engine-accent)]/10 dark:to-[var(--engine-info)]/10 border border-[var(--engine-info)]/20 dark:border-[var(--engine-info)]/30 rounded-2xl p-8 shadow-xl shadow-[var(--engine-info)]/5 dark:shadow-black/20 transition-all duration-300 relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-[var(--engine-info)]/20 text-[var(--engine-info)]">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="text-gray-900 dark:text-white font-bold text-lg">
                Busqueda automatica interna
              </h3>
              <span className="text-[10px] bg-[var(--engine-info)]/20 text-[var(--engine-info)] px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                Automatizado
              </span>
            </div>
          </div>

          <p className="text-gray-600 dark:text-[var(--engine-text-muted)] text-sm leading-relaxed mb-6 max-w-lg">
            SofLIA Engine investigara fuentes recientes por leccion, validara
            cada URL y repondra automaticamente las que fallen.
          </p>

          <div className="flex flex-wrap gap-3 mb-6">
            {[
              "Web search",
              "JSON estructurado",
              "Validacion URL",
              "Reposicion automatica",
              "Aprobacion automatica",
            ].map((tag) => (
              <span
                key={tag}
                className="text-[10px] bg-white dark:bg-[var(--engine-surface-solid)] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-full font-medium flex items-center gap-1.5"
              >
                <CheckCircle2
                  size={10}
                  className="text-[var(--engine-accent)]"
                />
                {tag}
              </span>
            ))}
          </div>

          <div className="mb-6 bg-white/70 dark:bg-[var(--engine-canvas)]/70 border border-gray-200 dark:border-[var(--engine-muted)]/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Settings2 size={14} className="text-[var(--engine-accent)]" />
              <h4 className="text-gray-700 dark:text-gray-300 font-medium text-sm">
                Criterios de busqueda
              </h4>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              className="w-full resize-y border border-gray-200 bg-white p-3 text-sm leading-relaxed text-gray-700 outline-none focus:border-[var(--engine-accent)] dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-surface-solid)] dark:text-gray-200"
              aria-label="Prompt de curaduria"
            />
            <p className="mt-2 text-[11px] text-gray-500 dark:text-[var(--engine-muted)]">
              Este es el prompt efectivo configurado para la empresa. Cualquier
              cambio realizado aqui se usara en esta ejecucion.
            </p>
            {lessonRequirements.length > 0 && (
              <div className="mt-4 max-h-56 space-y-2 overflow-y-auto border-t border-gray-200 pt-3 dark:border-[var(--engine-muted)]/10">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Fuentes requeridas por leccion
                </p>
                <p className="text-[11px] text-gray-500 dark:text-[var(--engine-muted)]">
                  Se calcula una fuente por cada 3 minutos objetivo de video,
                  con un minimo de 2.
                </p>
                {lessonRequirements.map((lesson) => (
                  <div
                    key={lesson.id}
                    className="flex items-center justify-between gap-4 text-xs text-gray-600 dark:text-[var(--engine-text-muted)]"
                  >
                    <span className="min-w-0 truncate">{lesson.title}</span>
                    <span className="shrink-0 font-semibold text-[var(--engine-info)]">
                      {lesson.videoTargetSeconds > 0
                        ? `${formatMinutes(lesson.videoTargetSeconds)} min · `
                        : ""}
                      {lesson.requiredSources} fuentes
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => onGenerate(prompt)}
            disabled={!hasTemario}
            className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all relative overflow-hidden ${
              hasTemario
                ? "bg-[var(--engine-accent)] hover:bg-[var(--engine-accent-hover)] text-[var(--engine-primary)] shadow-lg shadow-[var(--engine-accent)]/25 hover:shadow-[var(--engine-accent)]/40 hover:-translate-y-0.5"
                : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
            }`}
          >
            <Play size={20} fill="currentColor" />
            Iniciar curaduria automatica
          </button>
          <div className="mt-6 flex flex-col justify-center items-center gap-3 border-t border-[var(--engine-info)]/10 pt-6">
            <p className="text-gray-600 dark:text-[var(--engine-text-muted)] text-sm text-center font-medium">
              Ya hay un proceso en curso o quieres verificar resultados?
            </p>
            <button
              onClick={onRefresh}
              className="px-6 py-2.5 bg-white dark:bg-[#10151A] border border-gray-200 dark:border-[#334155] text-gray-700 dark:text-gray-300 rounded-xl shadow-sm hover:border-[var(--engine-info)]/50 hover:text-[var(--engine-info)] dark:hover:text-[var(--engine-info)] transition-all flex items-center justify-center gap-2 group"
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
            <p className="text-center text-gray-500 dark:text-[var(--engine-muted)] text-xs mt-3">
              Se procesaran {lessonsCount} lecciones en lotes controlados.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatMinutes(seconds: number) {
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}

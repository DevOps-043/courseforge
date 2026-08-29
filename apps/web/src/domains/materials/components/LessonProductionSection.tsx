"use client";

import { CheckCircle2, ChevronDown, Clock3 } from "lucide-react";
import type {
  MaterialComponent,
  MaterialLesson,
} from "../types/materials.types";
import { getLessonProductionProgress } from "./lesson-production-progress";

interface LessonProductionSectionProps {
  componentCards: React.ReactNode;
  components: MaterialComponent[];
  expanded: boolean;
  lesson: MaterialLesson;
  lessonNumber: number;
  onToggle: () => void;
}

export function LessonProductionSection({
  componentCards,
  components,
  expanded,
  lesson,
  lessonNumber,
  onToggle,
}: LessonProductionSectionProps) {
  const progress = getLessonProductionProgress(components);
  const contentId = `production-lesson-${lesson.id}`;
  const isComplete = progress.total > 0 && progress.completed === progress.total;
  const statusLabel = isComplete
    ? "Completada"
    : progress.inProgress > 0 || progress.completed > 0
      ? "En producción"
      : "Pendiente";

  return (
    <section
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-colors dark:bg-[var(--engine-surface-solid)] ${
        expanded
          ? "border-[var(--engine-info)]/35 shadow-[0_16px_40px_rgba(15,23,42,0.08)] dark:border-[var(--engine-info)]/30"
          : "border-gray-200 hover:border-[var(--engine-info)]/30 dark:border-[var(--engine-muted)]/15"
      }`}
    >
      <button
        type="button"
        aria-controls={contentId}
        aria-expanded={expanded}
        onClick={onToggle}
        className="group flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--engine-info)] dark:hover:bg-[var(--engine-info)]/5 sm:gap-4 sm:px-5"
      >
        <span
          aria-label={`Lección ${lessonNumber}`}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--engine-info)]/20 bg-gradient-to-br from-blue-50 to-cyan-50 text-xl font-black leading-none text-[var(--engine-info)] dark:from-[var(--engine-info)]/15 dark:to-[var(--engine-accent)]/5"
        >
          {String(lessonNumber).padStart(2, "0")}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold leading-snug text-gray-950 transition-colors group-hover:text-[var(--engine-info)] dark:text-white sm:text-lg">
            {lesson.lesson_title}
          </span>
          <span className="mt-1.5 flex items-center gap-2 text-xs text-gray-500 dark:text-[var(--engine-muted)]">
            <span>{progress.total} {progress.total === 1 ? "componente visual" : "componentes visuales"}</span>
            <span aria-hidden="true">·</span>
            <span>{progress.completed}/{progress.total} completados</span>
          </span>
        </span>

        <span className="hidden w-36 shrink-0 sm:block">
          <span className="mb-1.5 flex items-center justify-between text-[10px] font-semibold text-gray-500 dark:text-[var(--engine-muted)]">
            <span>Progreso</span>
            <span>{progress.percentage}%</span>
          </span>
          <span className="block h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-[var(--engine-canvas)]">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-[var(--engine-info)] to-[var(--engine-accent)] transition-[width] duration-300"
              style={{ width: `${progress.percentage}%` }}
            />
          </span>
        </span>

        <span
          className={`hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold md:flex ${
            isComplete
              ? "border-green-200 bg-green-50 text-green-700 dark:border-green-500/25 dark:bg-green-500/10 dark:text-green-400"
              : progress.inProgress > 0 || progress.completed > 0
                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
                : "border-gray-200 bg-gray-50 text-gray-600 dark:border-[var(--engine-muted)]/15 dark:bg-[var(--engine-canvas)] dark:text-[var(--engine-muted)]"
          }`}
        >
          {isComplete ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
          {statusLabel}
        </span>

        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors group-hover:border-[var(--engine-info)]/30 group-hover:text-[var(--engine-info)] dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)]">
          <ChevronDown
            size={18}
            aria-hidden="true"
            className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      <div
        id={contentId}
        hidden={!expanded}
        className="border-t border-gray-200 bg-gray-50/60 p-4 dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-canvas)]/35 sm:p-6"
      >
        <div className="grid gap-6">{componentCards}</div>
      </div>
    </section>
  );
}

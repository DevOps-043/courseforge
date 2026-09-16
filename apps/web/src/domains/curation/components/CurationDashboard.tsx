"use client";

import { useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  XCircle,
} from "lucide-react";
import type { CurationRow } from "../types/curation.types";

export interface CurationLessonOption {
  id: string;
  title: string;
  requiredSources: number;
  videoTargetSeconds: number;
}

interface CurationLessonGroup extends CurationLessonOption {
  sources: CurationRow[];
}

interface CurationDashboardProps {
  lessons: CurationLessonOption[];
  rows: CurationRow[];
  isGenerating: boolean;
}

function sourceStatus(row: CurationRow) {
  if (row.validation_report?.status) return row.validation_report.status;
  if (!row.auto_evaluated) return "pending";
  return row.apta ? "valid" : "invalid";
}

function normalizeLessonTitle(value: string | null | undefined) {
  return (value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function sourceDedupeKey(row: CurationRow) {
  const sourceKey =
    row.source_kind === "pdf"
      ? row.content_sha256 || row.storage_path || row.source_ref
      : row.source_ref;
  return [
    normalizeLessonTitle(row.lesson_title || row.lesson_id),
    row.source_kind || "url",
    (sourceKey || "").trim().toLowerCase(),
  ].join("|");
}

function preferSourceRow(current: CurationRow, next: CurationRow) {
  if (current.origin !== "manual" && next.origin === "manual") return next;
  if (!current.apta && next.apta) return next;
  return Date.parse(next.updated_at || "") >
    Date.parse(current.updated_at || "")
    ? next
    : current;
}

export function CurationDashboard({
  lessons,
  rows,
  isGenerating,
}: CurationDashboardProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [coverageFilter, setCoverageFilter] = useState<
    "all" | "complete" | "pending"
  >("all");

  const groups = useMemo(() => {
    const lessonMap = new Map<string, CurationLessonGroup>();
    const titleToKey = new Map<string, string>();

    for (const lesson of lessons) {
      const titleKey = normalizeLessonTitle(lesson.title);
      const key = titleKey || lesson.id;
      if (!lessonMap.has(key)) {
        lessonMap.set(key, { ...lesson, sources: [] });
      }
      if (titleKey) titleToKey.set(titleKey, key);
      titleToKey.set(normalizeLessonTitle(lesson.id), key);
    }

    const sourceKeysByGroup = new Map<string, Map<string, CurationRow>>();
    for (const row of rows) {
      const titleKey = normalizeLessonTitle(row.lesson_title);
      const idKey = normalizeLessonTitle(row.lesson_id);
      const key =
        titleToKey.get(titleKey) ||
        titleToKey.get(idKey) ||
        titleKey ||
        row.lesson_id;

      if (!lessonMap.has(key)) {
        lessonMap.set(key, {
          id: row.lesson_id,
          title: row.lesson_title || row.lesson_id,
          requiredSources: 2,
          videoTargetSeconds: 0,
          sources: [],
        });
      }

      const groupSourceKeys =
        sourceKeysByGroup.get(key) || new Map<string, CurationRow>();
      const dedupeKey = sourceDedupeKey(row);
      const existing = groupSourceKeys.get(dedupeKey);
      groupSourceKeys.set(
        dedupeKey,
        existing ? preferSourceRow(existing, row) : row,
      );
      sourceKeysByGroup.set(key, groupSourceKeys);
    }

    for (const [key, group] of lessonMap) {
      const uniqueSources = sourceKeysByGroup.get(key);
      group.sources = uniqueSources ? [...uniqueSources.values()] : [];
    }
    return [...lessonMap.values()];
  }, [lessons, rows]);

  const stats = useMemo(
    () => ({
      lessons: groups.length,
      completedLessons: groups.filter(
        (group) => getValidSourcesCount(group) >= group.requiredSources,
      ).length,
      coveredRequiredSources: groups.reduce(
        (total, group) =>
          total + Math.min(getValidSourcesCount(group), group.requiredSources),
        0,
      ),
      requiredSources: groups.reduce(
        (total, group) => total + group.requiredSources,
        0,
      ),
      valid: groups
        .flatMap((group) => group.sources)
        .filter((row) => sourceStatus(row) === "valid" && row.apta).length,
      invalid: groups
        .flatMap((group) => group.sources)
        .filter((row) => sourceStatus(row) === "invalid").length,
    }),
    [groups],
  );
  const visibleGroups = useMemo(
    () =>
      groups.filter((group) => {
        const isComplete = getValidSourcesCount(group) >= group.requiredSources;
        return (
          coverageFilter === "all" ||
          (coverageFilter === "complete" && isComplete) ||
          (coverageFilter === "pending" && !isComplete)
        );
      }),
    [coverageFilter, groups],
  );
  const visibleRowsCount = groups.reduce(
    (total, group) => total + group.sources.length,
    0,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 border border-gray-200 bg-white p-4 shadow-sm dark:border-[var(--engine-surface-hover)] dark:bg-[var(--engine-canvas)]">
        <Stat
          icon={BookOpen}
          value={`${stats.completedLessons}/${stats.lessons}`}
          label="Lecciones completas"
          tone="blue"
        />
        <Stat
          icon={CheckCircle2}
          value={`${stats.coveredRequiredSources}/${stats.requiredSources}`}
          label="Cobertura requerida"
          tone="green"
        />
        <Stat
          icon={CheckCircle2}
          value={stats.valid}
          label="Validas"
          tone="green"
        />
        <Stat
          icon={XCircle}
          value={stats.invalid}
          label="Invalidas"
          tone="red"
        />
        <span className="ml-auto text-xs text-gray-500 dark:text-[var(--engine-muted)]">
          {visibleRowsCount} fuentes encontradas y validadas por GPT
        </span>
      </div>

      <div
        className="flex flex-wrap gap-2"
        aria-label="Filtrar lecciones por cobertura"
      >
        {(
          [
            ["all", "Todas", stats.lessons],
            ["pending", "Pendientes", stats.lessons - stats.completedLessons],
            ["complete", "Completas", stats.completedLessons],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            onClick={() => setCoverageFilter(value)}
            className={`border px-3 py-1.5 text-xs font-semibold transition-colors ${
              coverageFilter === value
                ? "border-[var(--engine-info)] bg-[var(--engine-info)]/10 text-[var(--engine-info)]"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-400 dark:border-[var(--engine-surface-hover)] dark:bg-[var(--engine-canvas)] dark:text-gray-300"
            }`}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      {isGenerating && (
        <div className="border border-[var(--engine-accent)]/20 bg-[var(--engine-accent)]/5 p-4 text-sm text-[#008f79] dark:text-[var(--engine-accent)]">
          El sistema esta buscando candidatos. SofLIA - Engine valida cada
          resultado antes de guardarlo.
        </div>
      )}

      <div className="space-y-3">
        {visibleGroups.map((lesson) => {
          const isCollapsed = collapsed[lesson.id];
          const validCount = lesson.sources.filter(
            (source) => source.apta && sourceStatus(source) === "valid",
          ).length;
          const hasRequiredCoverage = validCount >= lesson.requiredSources;
          return (
            <section
              key={lesson.id}
              className="overflow-hidden border border-gray-200 bg-white dark:border-[var(--engine-surface-hover)] dark:bg-[var(--engine-canvas)]"
            >
              <div className="flex min-h-14 items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((current) => ({
                      ...current,
                      [lesson.id]: !current[lesson.id],
                    }))
                  }
                  className="p-1 text-gray-500 hover:text-gray-900 dark:hover:text-white"
                  title={isCollapsed ? "Mostrar fuentes" : "Ocultar fuentes"}
                >
                  {isCollapsed ? (
                    <ChevronRight size={18} />
                  ) : (
                    <ChevronDown size={18} />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {lesson.title}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-gray-500 dark:text-[var(--engine-muted)]">
                    {lesson.videoTargetSeconds > 0
                      ? `${formatMinutes(lesson.videoTargetSeconds)} min de video · ${lesson.requiredSources} fuentes requeridas`
                      : `${lesson.requiredSources} fuentes requeridas`}
                  </p>
                </div>
                <span
                  className={`text-xs font-semibold ${
                    hasRequiredCoverage
                      ? "text-[#00a98f]"
                      : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {validCount} / {lesson.requiredSources} validas
                </span>
              </div>

              {!isCollapsed && (
                <div className="border-t border-gray-200 p-4 dark:border-[var(--engine-surface-hover)]">
                  {lesson.sources.length === 0 ? (
                    <p className="py-4 text-center text-sm text-gray-500">
                      GPT continuara buscando fuentes web para esta leccion.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {lesson.sources.map((source) => (
                        <SourceRow key={source.id} source={source} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function formatMinutes(seconds: number) {
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}

function Stat({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof BookOpen;
  value: number | string;
  label: string;
  tone: "blue" | "green" | "red";
}) {
  const colors = {
    blue: "text-[var(--engine-info)] bg-[var(--engine-info)]/10",
    green: "text-[#00a98f] bg-[var(--engine-accent)]/10",
    red: "text-rose-500 bg-rose-500/10",
  };
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs ${colors[tone]}`}
    >
      <Icon size={15} />
      <strong>{value}</strong>
      {label}
    </span>
  );
}

function getValidSourcesCount(lesson: CurationLessonGroup) {
  return lesson.sources.filter(
    (source) => source.apta && sourceStatus(source) === "valid",
  ).length;
}

function SourceRow({ source }: { source: CurationRow }) {
  const status = sourceStatus(source);
  const statusLabel = {
    pending: "Pendiente",
    valid: "Valida",
    invalid: "Invalida",
    review_required: "Requiere revision",
  }[status];
  const statusClass =
    status === "valid"
      ? "text-[#00a98f] bg-[var(--engine-accent)]/10"
      : status === "invalid"
        ? "text-rose-500 bg-rose-500/10"
        : "text-amber-600 bg-amber-500/10 dark:text-amber-400";
  const isPdf = source.source_kind === "pdf";

  return (
    <div className="flex items-start gap-3 border border-gray-200 bg-gray-50 p-3 dark:border-[var(--engine-surface-hover)] dark:bg-[var(--engine-surface-solid)]">
      <FileText size={18} className="mt-0.5 shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-white">
            {source.source_title || source.file_name || "Fuente sin titulo"}
          </p>
          <span className="bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-600 dark:bg-[var(--engine-surface-hover)] dark:text-gray-300">
            GPT
          </span>
          <span
            className={`px-2 py-0.5 text-[10px] font-semibold ${statusClass}`}
          >
            {statusLabel}
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-gray-500">
          {isPdf ? source.file_name : source.source_ref}
        </p>
        {(source.validation_report?.reason || source.motivo_no_apta) && (
          <p className="mt-1 text-xs text-gray-500">
            {source.validation_report?.reason || source.motivo_no_apta}
          </p>
        )}
      </div>
      {!isPdf && (
        <a
          href={source.source_ref}
          target="_blank"
          rel="noreferrer"
          className="p-1.5 text-[var(--engine-info)] hover:bg-[var(--engine-info)]/10"
          title="Abrir fuente"
        >
          <ExternalLink size={15} />
        </a>
      )}
    </div>
  );
}

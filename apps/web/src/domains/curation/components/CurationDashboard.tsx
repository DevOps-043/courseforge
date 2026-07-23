"use client";

import { useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Link2,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import type { CurationRow } from "../types/curation.types";

export interface CurationLessonOption {
  id: string;
  title: string;
}

interface CurationLessonGroup extends CurationLessonOption {
  sources: CurationRow[];
}

interface CurationDashboardProps {
  lessons: CurationLessonOption[];
  rows: CurationRow[];
  onUpdateRow: (id: string, updates: Partial<CurationRow>) => void;
  onDeleteRow: (id: string) => void;
  onAddUrl: (lesson: { lessonId: string; lessonTitle: string }, url: string) => Promise<boolean>;
  onAddPdf: (lesson: { lessonId: string; lessonTitle: string }, file: File) => Promise<boolean>;
  onRevalidate: (id: string) => Promise<boolean>;
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
  return Date.parse(next.updated_at || "") > Date.parse(current.updated_at || "")
    ? next
    : current;
}

export function CurationDashboard({
  lessons,
  rows,
  onUpdateRow,
  onDeleteRow,
  onAddUrl,
  onAddPdf,
  onRevalidate,
  isGenerating,
}: CurationDashboardProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [addingUrl, setAddingUrl] = useState<string | null>(null);
  const [urlValue, setUrlValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

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
      const key = titleToKey.get(titleKey) || titleToKey.get(idKey) || titleKey || row.lesson_id;

      if (!lessonMap.has(key)) {
        lessonMap.set(key, {
          id: row.lesson_id,
          title: row.lesson_title || row.lesson_id,
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
      valid: groups.flatMap((group) => group.sources).filter((row) => sourceStatus(row) === "valid" && row.apta).length,
      invalid: groups.flatMap((group) => group.sources).filter((row) => sourceStatus(row) === "invalid").length,
      manual: groups.flatMap((group) => group.sources).filter((row) => row.origin === "manual").length,
    }),
    [groups],
  );
  const visibleRowsCount = groups.reduce(
    (total, group) => total + group.sources.length,
    0,
  );

  const submitUrl = async (lesson: CurationLessonOption) => {
    if (!urlValue.trim()) return;
    setBusy(`url:${lesson.id}`);
    const success = await onAddUrl(
      { lessonId: lesson.id, lessonTitle: lesson.title },
      urlValue.trim(),
    );
    setBusy(null);
    if (success) {
      setAddingUrl(null);
      setUrlValue("");
    }
  };

  const submitPdf = async (lesson: CurationLessonOption, file?: File) => {
    if (!file) return;
    setBusy(`pdf:${lesson.id}`);
    await onAddPdf({ lessonId: lesson.id, lessonTitle: lesson.title }, file);
    setBusy(null);
    const input = fileInputs.current[lesson.id];
    if (input) input.value = "";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 border border-gray-200 bg-white p-4 shadow-sm dark:border-[#1E2329] dark:bg-[#0F1419]">
        <Stat icon={BookOpen} value={stats.lessons} label="Lecciones" tone="blue" />
        <Stat icon={CheckCircle2} value={stats.valid} label="Validas" tone="green" />
        <Stat icon={XCircle} value={stats.invalid} label="Invalidas" tone="red" />
        <span className="ml-auto text-xs text-gray-500 dark:text-[#6C757D]">
          {stats.manual} manuales / {visibleRowsCount - stats.manual} automaticas
        </span>
      </div>

      {isGenerating && (
        <div className="border border-[#00D4B3]/20 bg-[#00D4B3]/5 p-4 text-sm text-[#008f79] dark:text-[#00D4B3]">
          OpenAI esta buscando candidatos. Courseforge valida cada resultado antes de guardarlo.
        </div>
      )}

      <div className="space-y-3">
        {groups.map((lesson) => {
          const isCollapsed = collapsed[lesson.id];
          const validCount = lesson.sources.filter(
            (source) => source.apta && sourceStatus(source) === "valid",
          ).length;
          return (
            <section
              key={lesson.id}
              className="overflow-hidden border border-gray-200 bg-white dark:border-[#1E2329] dark:bg-[#0F1419]"
            >
              <div className="flex min-h-14 items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((current) => ({ ...current, [lesson.id]: !current[lesson.id] }))
                  }
                  className="p-1 text-gray-500 hover:text-gray-900 dark:hover:text-white"
                  title={isCollapsed ? "Mostrar fuentes" : "Ocultar fuentes"}
                >
                  {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                </button>
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">
                  {lesson.title}
                </h3>
                <span
                  className={`text-xs font-semibold ${
                    validCount >= 1 ? "text-[#00a98f]" : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {validCount} / 2 validas
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAddingUrl(addingUrl === lesson.id ? null : lesson.id);
                    setUrlValue("");
                  }}
                  className="p-2 text-[#1F5AF6] hover:bg-[#1F5AF6]/10"
                  title="Agregar URL"
                >
                  <Link2 size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => fileInputs.current[lesson.id]?.click()}
                  className="p-2 text-[#00a98f] hover:bg-[#00D4B3]/10"
                  title="Subir PDF"
                >
                  <Upload size={17} />
                </button>
                <input
                  ref={(element) => {
                    fileInputs.current[lesson.id] = element;
                  }}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(event) => submitPdf(lesson, event.target.files?.[0])}
                />
              </div>

              {!isCollapsed && (
                <div className="border-t border-gray-200 p-4 dark:border-[#1E2329]">
                  {addingUrl === lesson.id && (
                    <div className="mb-3 flex gap-2">
                      <input
                        type="url"
                        value={urlValue}
                        onChange={(event) => setUrlValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void submitUrl(lesson);
                        }}
                        placeholder="https://..."
                        className="min-w-0 flex-1 border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-[#1F5AF6] dark:border-[#1E2329] dark:bg-[#151A21] dark:text-white"
                      />
                      <button
                        type="button"
                        disabled={busy === `url:${lesson.id}`}
                        onClick={() => void submitUrl(lesson)}
                        className="bg-[#1F5AF6] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Agregar
                      </button>
                    </div>
                  )}

                  {busy === `pdf:${lesson.id}` && (
                    <p className="mb-3 text-xs text-[#00a98f]">Subiendo y validando PDF...</p>
                  )}

                  {lesson.sources.length === 0 ? (
                    <p className="py-4 text-center text-sm text-gray-500">
                      Esta leccion aun no tiene fuentes. Agrega una URL o PDF propio.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {lesson.sources.map((source) => (
                        <SourceRow
                          key={source.id}
                          source={source}
                          onUpdate={onUpdateRow}
                          onDelete={onDeleteRow}
                          onRevalidate={onRevalidate}
                        />
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

function Stat({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof BookOpen;
  value: number;
  label: string;
  tone: "blue" | "green" | "red";
}) {
  const colors = {
    blue: "text-[#1F5AF6] bg-[#1F5AF6]/10",
    green: "text-[#00a98f] bg-[#00D4B3]/10",
    red: "text-rose-500 bg-rose-500/10",
  };
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs ${colors[tone]}`}>
      <Icon size={15} />
      <strong>{value}</strong>
      {label}
    </span>
  );
}

function SourceRow({
  source,
  onUpdate,
  onDelete,
  onRevalidate,
}: {
  source: CurationRow;
  onUpdate: (id: string, updates: Partial<CurationRow>) => void;
  onDelete: (id: string) => void;
  onRevalidate: (id: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const status = sourceStatus(source);
  const statusLabel = {
    pending: "Pendiente",
    valid: "Valida",
    invalid: "Invalida",
    review_required: "Requiere revision",
  }[status];
  const statusClass =
    status === "valid"
      ? "text-[#00a98f] bg-[#00D4B3]/10"
      : status === "invalid"
        ? "text-rose-500 bg-rose-500/10"
        : "text-amber-600 bg-amber-500/10 dark:text-amber-400";
  const isPdf = source.source_kind === "pdf";

  return (
    <div className="flex items-start gap-3 border border-gray-200 bg-gray-50 p-3 dark:border-[#1E2329] dark:bg-[#151A21]">
      <FileText size={18} className="mt-0.5 shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-white">
            {source.source_title || source.file_name || "Fuente sin titulo"}
          </p>
          <span className="bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-600 dark:bg-[#1E2329] dark:text-gray-300">
            {source.origin === "manual" ? "Manual" : "Automatica"}
          </span>
          <span className={`px-2 py-0.5 text-[10px] font-semibold ${statusClass}`}>
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
          className="p-1.5 text-[#1F5AF6] hover:bg-[#1F5AF6]/10"
          title="Abrir fuente"
        >
          <ExternalLink size={15} />
        </a>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onRevalidate(source.id);
          setBusy(false);
        }}
        className="p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 dark:hover:bg-[#1E2329] dark:hover:text-white"
        title="Revalidar fuente"
      >
        <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirm("Eliminar esta fuente?")) onDelete(source.id);
        }}
        className="p-1.5 text-rose-500 hover:bg-rose-500/10"
        title="Eliminar fuente"
      >
        <Trash2 size={15} />
      </button>
      <button
        type="button"
        onClick={() => onUpdate(source.id, { apta: !source.apta })}
        className={`px-2 py-1 text-xs ${source.apta ? "text-[#00a98f]" : "text-gray-500"}`}
        title="Cambiar aptitud manual"
      >
        {source.apta ? "Apta" : "No apta"}
      </button>
    </div>
  );
}

import { Esp02Route } from "../types/syllabus.types";
import type { SyllabusSourceDocument } from "../syllabus-source-documents";
import { SyllabusDocumentUploader } from "./SyllabusDocumentUploader";
import { SyllabusRouteSelector } from "./SyllabusRouteSelector";

interface SyllabusSetupPanelProps {
  artifactId: string;
  documents: SyllabusSourceDocument[];
  documentsUploading: boolean;
  route: Esp02Route | null;
  configuredPrompt: string;
  prompt: string;
  promptError: string | null;
  promptLoading: boolean;
  promptSource: "organization" | "global" | "default" | null;
  promptVersion: string | null;
  onDocumentsChange: (documents: SyllabusSourceDocument[]) => void;
  onDocumentsUploadingChange: (uploading: boolean) => void;
  onRouteChange: (route: Esp02Route | null) => void;
  onPromptChange: (prompt: string) => void;
  onPromptRetry: () => void;
  onGenerate: () => void;
}

export function SyllabusSetupPanel({
  artifactId,
  documents,
  documentsUploading,
  route,
  configuredPrompt,
  prompt,
  promptError,
  promptLoading,
  promptSource,
  promptVersion,
  onDocumentsChange,
  onDocumentsUploadingChange,
  onRouteChange,
  onPromptChange,
  onPromptRetry,
  onGenerate,
}: SyllabusSetupPanelProps) {
  const requiresDocuments = route === "A_WITH_SOURCE";
  const promptWasModified = prompt.trim() !== configuredPrompt.trim();
  const canGenerate = Boolean(route) &&
    !documentsUploading &&
    !promptLoading &&
    !promptError &&
    Boolean(prompt.trim()) &&
    (!requiresDocuments || documents.length > 0);
  const promptSourceLabel = promptSource === "organization"
    ? "Configuración de la empresa"
    : promptSource === "global"
      ? "Configuración global"
      : "Prompt predeterminado";

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-[var(--engine-surface-hover)] border border-gray-200 dark:border-white/5 rounded-2xl p-6">
        <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-6">
          Método de Generación
        </h4>
        <SyllabusRouteSelector
          selectedRoute={route}
          onSelect={onRouteChange}
        />
      </div>

      {requiresDocuments ? (
        <SyllabusDocumentUploader
          artifactId={artifactId}
          documents={documents}
          onChange={onDocumentsChange}
          onUploadingChange={onDocumentsUploadingChange}
        />
      ) : null}

      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-white/5 dark:bg-[var(--engine-surface-hover)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold uppercase tracking-widest text-gray-400">
                Prompt de generación
              </h4>
              {!promptLoading && !promptError ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  {promptWasModified ? "Modificado para esta generación" : promptSourceLabel}
                </span>
              ) : null}
            </div>
            <p className="mt-2 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
              Revisa el prompt efectivo antes de generar. Los cambios de este campo se aplican solo a este temario y no modifican la configuración general de la empresa.
            </p>
          </div>

          {promptWasModified ? (
            <button
              type="button"
              onClick={() => onPromptChange(configuredPrompt)}
              className="shrink-0 text-sm font-semibold text-[var(--engine-primary)] hover:underline dark:text-[var(--engine-accent)]"
            >
              Restaurar configurado
            </button>
          ) : null}
        </div>

        {promptLoading ? (
          <div className="mt-5 h-48 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" />
        ) : promptError ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            <p>{promptError}</p>
            <button
              type="button"
              onClick={onPromptRetry}
              className="mt-2 font-semibold underline underline-offset-2"
            >
              Reintentar carga
            </button>
          </div>
        ) : (
          <>
            <textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              rows={12}
              maxLength={40_000}
              spellCheck={false}
              className="mt-5 w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-sm leading-6 text-gray-800 outline-none transition focus:border-[var(--engine-accent)] focus:ring-2 focus:ring-[var(--engine-accent)]/20 dark:border-white/10 dark:bg-black/20 dark:text-gray-200"
              aria-label="Prompt de generación del temario"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
              <span>
                Variables disponibles: {"{{ideaCentral}}"}, {"{{objetivos}}"}, {"{{routeContext}}"} y {"{{documentContext}}"}.
              </span>
              <span>
                {prompt.length.toLocaleString("es-MX")} / 40,000 caracteres
                {promptVersion ? ` · versión ${promptVersion}` : ""}
              </span>
            </div>
          </>
        )}
      </section>

      <button
        onClick={onGenerate}
        className={`
          w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all
          ${
            canGenerate
              ? "bg-[var(--engine-accent)] text-[var(--engine-primary)] hover:bg-[var(--engine-accent-hover)] shadow-[0_4px_20px_rgba(0,212,179,0.2)]"
              : "bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
          }
        `}
        disabled={!canGenerate}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
        {documentsUploading ? "Procesando documentos…" : "Generar Temario con IA"}
      </button>
    </div>
  );
}

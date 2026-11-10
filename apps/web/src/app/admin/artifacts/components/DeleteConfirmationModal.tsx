"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { EngineDialog } from "@/components/ui/EngineDialog";
import { deleteArtifactAction, downloadSyllabusDeletionDocumentAction, previewArtifactDeletionAction } from "@/domains/artifacts/actions/delete-artifact.action";
import { sourceJsonRequest } from "@/domains/course-sources/course-source.client";

type Preview = Extract<Awaited<ReturnType<typeof previewArtifactDeletionAction>>, { success: true }>["preview"];
type DeletionDocument = Preview["documents"][number];

interface DeleteConfirmationModalProps {
  artifactId: string;
  onClose: () => void;
  onDeleted: (cleanupPending: boolean) => void;
  artifactTitle: string;
}

export function DeleteConfirmationModal({
  artifactId,
  onClose,
  onDeleted,
  artifactTitle,
}: DeleteConfirmationModalProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "delete" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const reviewing = preview !== null;
  const hasOriginals = preview?.documents.some(({ kind }) => kind === "original") ?? false;

  useEffect(() => {
    if (!reviewing) return;
    const focus = window.setTimeout(() => reviewHeading.current?.focus(), 0);
    return () => window.clearTimeout(focus);
  }, [reviewing]);

  async function advance() {
    if (busy) return;
    setError(null);
    setBusy(preview ? "delete" : "preview");
    try {
      if (!preview) {
        const result = await previewArtifactDeletionAction(artifactId);
        if (result.success) setPreview(result.preview);
        else setError(result.error);
        return;
      }

      const result = await deleteArtifactAction(artifactId, preview.confirmation);
      if (!result.success) {
        if (result.refresh) setPreview(null);
        setError(result.error);
        return;
      }
      onDeleted(hasOriginals);
    } catch {
      setError(preview ? "No se pudo confirmar la eliminación. Actualiza la lista antes de reintentar."
        : "No se pudieron consultar los documentos. Intenta de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  async function download(source: DeletionDocument) {
    if (busy) return;
    setError(null);
    setBusy("download");
    try {
      if (source.kind === "original") {
        const result = await sourceJsonRequest(`/api/artifacts/${artifactId}/sources/documents/${source.id}?download=1`);
        const link = document.createElement("a");
        link.href = result.url;
        link.download = source.filename;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.click();
        return;
      }

      const result = await downloadSyllabusDeletionDocumentAction(artifactId, source.id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      const url = URL.createObjectURL(new Blob([result.text], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("El archivo no está disponible para descargar. Una reserva puede existir sin archivo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <EngineDialog
      isOpen
      onClose={onClose}
      closeDisabled={busy !== null}
      size="compact"
      eyebrow={reviewing ? "Paso 2 de 2" : "Paso 1 de 2"}
      title="Eliminar artefacto"
      description={reviewing ? "Revisa qué documentos se eliminarán y descarga los que quieras conservar."
        : "Confirma qué artefacto quieres revisar antes de eliminarlo."}
      icon={<AlertTriangle />}
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className="min-h-11 rounded-[0.86rem] border border-[var(--engine-border)] bg-[var(--engine-surface-soft)] px-4 text-sm font-medium text-[var(--engine-text-muted)] hover:text-[var(--engine-text)] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void advance()}
            disabled={busy !== null}
            className="flex min-h-11 items-center justify-center gap-2 rounded-[0.86rem] border border-red-500 bg-red-500 px-4 text-sm font-medium text-white shadow-lg hover:-translate-y-px hover:bg-red-600 disabled:opacity-50"
          >
            {busy === "preview" || busy === "delete" ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            {busy === "preview" ? "Consultando..." : busy === "delete" ? "Eliminando..." : reviewing ? "Eliminar definitivamente" : "Revisar documentos"}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
        <div className="rounded-2xl border border-[var(--engine-border)] bg-[var(--engine-surface-soft)] p-4">
          <p className="mb-1 font-[var(--font-system-label)] text-[0.56rem] font-semibold uppercase tracking-[0.11em] text-[var(--engine-text-muted)]">Artefacto seleccionado</p>
          <p className="line-clamp-3 text-sm font-medium text-[var(--engine-text)]">{artifactTitle}</p>
        </div>
        {preview && (
          <section aria-labelledby="artifact-deletion-documents" className="space-y-2 text-sm">
            <h3 ref={reviewHeading} tabIndex={-1} id="artifact-deletion-documents" className="font-semibold">
              Documentos que se eliminarán ({preview.documents.length})
            </h3>
            {preview.documents.length === 0 ? <p>Este artefacto no tiene documentos registrados.</p> : (
              <ul className="max-h-52 divide-y divide-[var(--engine-border)] overflow-y-auto">
                {preview.documents.map((source) => (
                  <li key={`${source.kind}-${source.id}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                    <div className="min-w-0 break-words">
                      <p>{source.filename}</p>
                      <p className="text-xs text-[var(--engine-text-muted)]">
                        {source.kind === "temario" ? "Temario · texto extraído" : source.status === "RESERVED" ? "Reserva de carga" : "Fuente del curso"}
                      </p>
                    </div>
                    <button type="button" disabled={busy !== null} onClick={() => void download(source)}
                      aria-label={source.kind === "temario" ? `Descargar TXT de ${source.filename}` : `Descargar original de ${source.filename}`}
                      className="min-h-11 text-[var(--engine-text)] underline disabled:opacity-50">
                      {source.kind === "temario" ? "Descargar TXT" : "Descargar original"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {hasOriginals && (
              <p className="text-xs text-[var(--engine-text-muted)]">La limpieza de los originales se ejecuta en segundo plano cuando ya no se puedan usar las cargas firmadas.</p>
            )}
            <p className="text-xs text-[var(--engine-text-muted)]">También se eliminarán los datos vinculados del artefacto.</p>
          </section>
        )}
        <p className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.07] p-3 text-xs leading-5 text-red-500">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          Esta acción no se puede deshacer.
        </p>
      </div>
    </EngineDialog>
  );
}

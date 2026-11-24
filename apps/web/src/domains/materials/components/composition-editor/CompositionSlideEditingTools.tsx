"use client";

import { Layers } from "lucide-react";
import { EngineDialog } from "@/components/ui/EngineDialog";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionHtmlEditorialHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";
import { CompositionHtmlRecoveryCenter } from "./CompositionHtmlRecoveryCenter";

/** Abrir herramientas no inicia consultas ni prepara campos automáticamente. */
export function CompositionSlideEditingTools({ open, onClose, busy, draftId, compositionId, host, document, onRecalculateDuration }: {
  open: boolean; onClose: () => void; busy: boolean; draftId: string; compositionId: string;
  host: CompositionHtmlEditorialHost; document: CompositionEditorDocument;
  onRecalculateDuration: () => Promise<void>;
}) {
  return <EngineDialog isOpen={open} onClose={onClose} closeDisabled={busy} size="wide"
    title="Campos de diapositivas" icon={<Layers size={20} />}
    description="Prepara los campos del contenido existente y consulta los intentos pendientes. Esta herramienta no genera diapositivas ni renderiza el video.">
    {open && !document.canvas.durationSource && document.canvas.durationMode !== "USER_EDITED" &&
      <div className="mb-4 rounded-lg border border-amber-300 p-3 text-sm" role="status">
        <p>Antes de guardar la primera revisión, confirma la duración de las diapositivas. El cálculo conserva la posición de los clips.</p>
        <button type="button" disabled={busy} onClick={() => void onRecalculateDuration()} className="mt-2 rounded border px-3 py-2">Recalcular duración</button>
      </div>}
    {open && <CompositionHtmlRecoveryCenter draftId={draftId} compositionId={compositionId} host={host} document={document} />}
  </EngineDialog>;
}

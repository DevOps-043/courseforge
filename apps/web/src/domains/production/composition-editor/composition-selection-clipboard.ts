const COMPOSITION_SELECTION_CLIPBOARD_MAX_CLIPS = 100;
const COMPOSITION_SELECTION_CLIPBOARD_TTL_MS = 30 * 60 * 1_000;

export type CompositionSelectionClipboardEntry = Readonly<{
  clipIds: readonly string[];
  compositionId: string;
  copiedAt: number;
}>;

export class CompositionSelectionClipboardError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function createCompositionSelectionClipboardEntry(params: {
  clipIds: Iterable<string>;
  compositionId: string;
  now?: number;
}): CompositionSelectionClipboardEntry {
  const compositionId = params.compositionId.trim();
  if (!compositionId) throw new CompositionSelectionClipboardError("No se pudo identificar la composición de origen.");
  const clipIds = [...new Set(params.clipIds)].filter(Boolean);
  if (clipIds.length === 0) throw new CompositionSelectionClipboardError("Selecciona al menos un clip para copiar.");
  if (clipIds.length > COMPOSITION_SELECTION_CLIPBOARD_MAX_CLIPS) {
    throw new CompositionSelectionClipboardError(
      `El portapapeles admite como máximo ${COMPOSITION_SELECTION_CLIPBOARD_MAX_CLIPS} clips.`,
    );
  }
  const copiedAt = params.now ?? Date.now();
  if (!Number.isFinite(copiedAt)) throw new CompositionSelectionClipboardError("La marca de tiempo del portapapeles no es válida.");
  return Object.freeze({ clipIds: Object.freeze(clipIds), compositionId, copiedAt });
}

export function resolveCompositionSelectionClipboardEntry(
  entry: CompositionSelectionClipboardEntry | null,
  params: { compositionId: string; now?: number },
): readonly string[] {
  if (!entry) throw new CompositionSelectionClipboardError("Copia una selección antes de pegar.");
  if (entry.compositionId !== params.compositionId) {
    throw new CompositionSelectionClipboardError("El portapapeles pertenece a otra composición.");
  }
  const now = params.now ?? Date.now();
  if (!Number.isFinite(now) || now < entry.copiedAt || now - entry.copiedAt > COMPOSITION_SELECTION_CLIPBOARD_TTL_MS) {
    throw new CompositionSelectionClipboardError("El portapapeles de la composición expiró. Copia la selección nuevamente.");
  }
  return entry.clipIds;
}

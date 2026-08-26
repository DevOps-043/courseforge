import type { CompositionEditorDocument } from "./composition-document.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";

export type CompositionBrandingClip = {
  clipId: string;
  durationSeconds: number;
};

/**
 * Reconciles the timing envelope for already-linked intro/outro clips.
 * Asset resolution and clip creation deliberately happen elsewhere; this
 * service owns only deterministic placement and is safe to repeat.
 */
export function buildCompositionBrandingPlacementPatch(params: {
  document: CompositionEditorDocument;
  intro: CompositionBrandingClip | null;
  outro: CompositionBrandingClip | null;
}): CompositionEditorPatchOperation[] {
  const brandingIds = new Set([params.intro?.clipId, params.outro?.clipId].filter((id): id is string => Boolean(id)));
  const clipsById = new Map(params.document.clips.map((clip) => [clip.id, clip]));
  for (const id of brandingIds) {
    if (!clipsById.has(id)) throw new Error("El clip de branding no pertenece a la composición.");
  }
  const content = params.document.clips.filter((clip) => !brandingIds.has(clip.id));
  if (content.length === 0) throw new Error("La composición debe conservar contenido antes de colocar intro u outro.");

  const introDuration = normalizeDuration(params.intro?.durationSeconds || 0);
  const currentContentStart = Math.min(...content.map((clip) => clip.startSeconds));
  const shift = roundSeconds(introDuration - currentContentStart);
  const operations: CompositionEditorPatchOperation[] = [];
  const projectedContentEnd = Math.max(...content.map((clip) => clip.startSeconds + shift + clip.durationSeconds));
  const outroDuration = normalizeDuration(params.outro?.durationSeconds || 0);
  const canvasDuration = roundSeconds(projectedContentEnd + outroDuration);

  const canvasOperation: CompositionEditorPatchOperation = {
    clipId: "canvas",
    durationMode: "AUTO",
    durationSeconds: canvasDuration,
    ...(params.document.canvas.durationSource ? { durationSource: params.document.canvas.durationSource } : {}),
    type: "composition.canvas-duration",
  };
  if (params.intro) {
    operations.push({ clipId: params.intro.clipId, durationSeconds: introDuration, startSeconds: 0, type: "clip.estimated-timing" });
  }
  for (const clip of content) {
    if (Math.abs(shift) <= 0.001) continue;
    operations.push({ clipId: clip.id, startSeconds: roundSeconds(clip.startSeconds + shift), type: "clip.move" });
  }
  if (params.outro) {
    operations.push({ clipId: params.outro.clipId, durationSeconds: outroDuration, startSeconds: projectedContentEnd, type: "clip.estimated-timing" });
  }
  // Growing must happen first; shrinking can only happen after the old outro
  // has moved, otherwise document validation observes it past the canvas.
  return canvasDuration < params.document.canvas.durationSeconds
    ? [...operations, canvasOperation]
    : [canvasOperation, ...operations];
}

function normalizeDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("La duración de intro/outro debe ser mayor que cero.");
  return roundSeconds(value);
}

function roundSeconds(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

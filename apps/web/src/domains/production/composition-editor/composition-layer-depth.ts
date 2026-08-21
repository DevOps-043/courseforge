export const COMPOSITION_LAYER_MIN = 0;
export const COMPOSITION_LAYER_MAX = 10;

export const DEFAULT_COMPOSITION_LAYER = {
  AUDIO: 0,
  AVATAR: 2,
  BROLL: 2,
  DECK: 1,
  VISUAL: 0,
} as const;

export function clampCompositionLayerDepth(value: number): number {
  if (!Number.isFinite(value)) return COMPOSITION_LAYER_MIN;
  return Math.max(
    COMPOSITION_LAYER_MIN,
    Math.min(COMPOSITION_LAYER_MAX, Math.round(value)),
  );
}

/**
 * Keeps drafts written before the 0..10 layer contract readable. The returned
 * value is a copy so immutable history rows are never mutated in memory.
 */
export function normalizeCompositionDocumentLayerDepths(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const document = input as Record<string, unknown>;
  if (!Array.isArray(document.clips)) return input;

  return {
    ...document,
    clips: document.clips.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return candidate;
      }
      const clip = candidate as Record<string, unknown>;
      if (!clip.layout || typeof clip.layout !== "object" || Array.isArray(clip.layout)) {
        return candidate;
      }
      const layout = clip.layout as Record<string, unknown>;
      if (typeof layout.zIndex !== "number") return candidate;
      return {
        ...clip,
        layout: {
          ...layout,
          zIndex: clampCompositionLayerDepth(layout.zIndex),
        },
      };
    }),
  };
}

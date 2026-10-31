export const COMPOSITION_PREVIEW_ZOOM = { minimum: 0.25, maximum: 4, step: 0.05, fit: 1, presets: [0.25, 0.5, 1, 1.5, 2, 3, 4] } as const;
export const COMPOSITION_STUDIO_PANES = { minimum: 30, maximum: 85, initial: 74, expanded: 82, keyboardStep: 5 } as const;

export function normalizeCompositionPreviewZoom(scale: number) {
  return Number.isFinite(scale)
    ? Math.max(COMPOSITION_PREVIEW_ZOOM.minimum, Math.min(COMPOSITION_PREVIEW_ZOOM.maximum, Math.round(scale * 100) / 100))
    : COMPOSITION_PREVIEW_ZOOM.fit;
}

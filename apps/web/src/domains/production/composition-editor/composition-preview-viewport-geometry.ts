export type CompositionPreviewCanvasBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
  scale: number;
};

/** Shared with the sandbox runtime so external guides use the exact same centered fit. */
export function resolveCompositionPreviewCanvasBounds(input: {
  canvasWidth: number;
  canvasHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  zoom: number;
}): CompositionPreviewCanvasBounds | null {
  const { canvasWidth, canvasHeight, viewportWidth, viewportHeight, zoom } = input;
  if (![canvasWidth, canvasHeight, viewportWidth, viewportHeight, zoom].every(Number.isFinite)
    || canvasWidth <= 0 || canvasHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0
    || zoom < 0.5 || zoom > 2) return null;
  const scale = Math.max(0.01, Math.min(viewportWidth / canvasWidth, viewportHeight / canvasHeight)) * zoom;
  const width = canvasWidth * scale;
  const height = canvasHeight * scale;
  return { width, height, x: (viewportWidth - width) / 2, y: (viewportHeight - height) / 2, scale };
}

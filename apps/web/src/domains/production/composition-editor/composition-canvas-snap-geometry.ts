export const COMPOSITION_CANVAS_SNAP_GEOMETRY = {
  screenTolerancePixels: 7,
  gridSizePixels: 16,
  minimumSizePixels: 24,
} as const;

/** Converts screen-space tolerance without changing it at high preview zoom. */
export function compositionCanvasSnapTolerance(scale: number, screenTolerancePixels: number): number {
  return Number.isFinite(scale) && scale > 0 && Number.isFinite(screenTolerancePixels) && screenTolerancePixels >= 0
    ? screenTolerancePixels / scale
    : 0;
}

/** Canvas bounds take precedence when the minimum size cannot fit. Self-contained for runtime injection. */
export function boundCompositionCanvasResize(input: {
  width: number;
  height: number;
  maxWidth: number;
  maxHeight: number;
  aspectRatio: number | null;
  minimumSize: number;
}): { width: number; height: number } | null {
  const { width, height, maxWidth, maxHeight, aspectRatio, minimumSize } = input;
  if (![width, height, maxWidth, maxHeight, minimumSize].every(Number.isFinite)
    || maxWidth <= 0 || maxHeight <= 0 || minimumSize < 0) return null;
  if (aspectRatio !== null) {
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;
    const maximumWidth = Math.min(maxWidth, maxHeight * aspectRatio);
    const minimumWidth = Math.min(maximumWidth, Math.max(minimumSize, minimumSize * aspectRatio));
    const boundedWidth = Math.max(minimumWidth, Math.min(maximumWidth, width));
    return { width: boundedWidth, height: boundedWidth / aspectRatio };
  }
  return {
    width: Math.max(Math.min(minimumSize, maxWidth), Math.min(maxWidth, width)),
    height: Math.max(Math.min(minimumSize, maxHeight), Math.min(maxHeight, height)),
  };
}

export function renderCompositionCanvasSnapGeometry(): string {
  return `
      const canvasSnapGeometry = ${JSON.stringify(COMPOSITION_CANVAS_SNAP_GEOMETRY)};
      const canvasSnapTolerance = (${compositionCanvasSnapTolerance.toString()});
      const boundCanvasResize = (${boundCompositionCanvasResize.toString()});
  `;
}

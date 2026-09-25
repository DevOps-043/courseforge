export const COMPOSITION_CANVAS_FORMATS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
} as const;

export type CompositionCanvasFormat = keyof typeof COMPOSITION_CANVAS_FORMATS;

export function resolveCompositionCanvasFormat(canvas: { width: number; height: number }): CompositionCanvasFormat {
  const format = (Object.keys(COMPOSITION_CANVAS_FORMATS) as CompositionCanvasFormat[]).find((key) => {
    const preset = COMPOSITION_CANVAS_FORMATS[key];
    return canvas.width * preset.height === canvas.height * preset.width;
  });
  if (!format) throw new Error("El formato del lienzo no es compatible. Selecciona horizontal, vertical o cuadrado.");
  return format;
}

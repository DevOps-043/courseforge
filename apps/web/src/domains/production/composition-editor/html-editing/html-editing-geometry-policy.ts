/** Shared declaration and computed-geometry budgets. Neither phase is an OS quota. */
export const HTML_EDITING_GEOMETRY_POLICY = Object.freeze({
  maximumPixels: 8192, maximumPercent: 1000, maximumFontPixels: 512,
  maximumLineHeight: 4, maximumRelativeLength: 128,
  maximumSvgMagnitude: 8192, maximumSvgNumericTokens: 4096,
  maximumSvgTransforms: 8, maximumSvgScale: 16, maximumEffectPixels: 128,
  maximumSvgDashValues: 128, maximumStrokeMiterLimit: 16,
});

export const TEXT_PAINT_REGION_EXPANSION_POLICY = "JOINT_NATIVE_PAINT_DELTA_NEAREST_ROI_V1" as const;
export const OFFCANVAS_TEXT_PAINT_SEED_POLICY = "OFFCANVAS_FILTERED_PAINT_SEED_V1" as const;

/** Local text-region policy; requires trusted geometry from the frozen preview. */
export const COMPOSITION_TEXT_PARITY_POLICY = Object.freeze({
  id: "text-region-rgb-shift-one-v1",
  maximumDisplacementPixels: 1,
  maximumGeometryCoordinatePixels: 1_000_000,
  pixelDifferenceThreshold: 4,
  maximumMismatchedPixelRatio: 0.0005,
  maximumAbsenceProbeMismatchedPixelRatio: 0,
  maximumMeanAbsoluteError: 0.25,
  minimumLuminanceRange: 5,
  maximumOpacityDrift: 0.0001,
  maximumPaintPoseDrift: 0.02,
  maximumOverlayReferencesPerCheckpoint: 1024,
  maximumOverlayReferencesPerCapture: 4096,
  maximumOverlayAncestorChecksPerCheckpoint: 4096,
  regionPaddingPixels: 2,
  maximumRegions: 256,
  maximumRegionsPerCapture: 2048,
  maximumComparedPixels: 1_048_576,
  maximumFramePixels: 3840 * 2160,
  maximumPaintCapturePngBytes: 8 * 1024 ** 2,
  maximumTextCharactersPerElement: 20_000,
  maximumTextCharactersPerCheckpoint: 65_536,
  maximumAncestorDepth: 64,
});

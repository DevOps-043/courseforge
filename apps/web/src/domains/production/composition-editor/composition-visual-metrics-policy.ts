/** Encoded RGB luminance SSIM; this policy does not attest a decoder's color space. */
export const COMPOSITION_SSIM_POLICY = Object.freeze({
  id: "ssim-gaussian-11-coded-bt709-luma-v1",
  minimum: 0.995,
  windowSize: 11,
  sigma: 1.5,
  k1: 0.01,
  k2: 0.03,
  dynamicRange: 255,
  edgeMode: "REPLICATE" as const,
  downsampling: "NONE" as const,
  luminanceWeights: [0.2126, 0.7152, 0.0722] as const,
  maximumPixels: 3840 * 2160,
});

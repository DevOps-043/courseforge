import { COMPOSITION_SSIM_POLICY as policy } from "../composition-visual-metrics-policy";

const radius = (policy.windowSize - 1) / 2;
const kernel = Array.from({length: policy.windowSize}, (_, index) => Math.exp(-((index - radius) ** 2) / (2 * policy.sigma ** 2)));
const kernelSum = kernel.reduce((sum, weight) => sum + weight, 0);
const weights = kernel.map((weight) => weight / kernelSum);
const moments = 5;

/**
 * Wang et al. SSIM equation with population moments and a separable Gaussian.
 * Full-resolution, stride one, replicate edges, no registration or gain correction.
 * Ring-buffer storage is O(width * windowSize), independent of image height.
 * https://www.cns.nyu.edu/pub/lcv/wang03-preprint.pdf
 */
export function measureFrameSsim(preview: Uint8Array, rendered: Uint8Array, width: number, height: number, channels: number): number {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
    || width * height > policy.maximumPixels || (channels !== 3 && channels !== 4)
    || preview.length !== width * height * channels || rendered.length !== preview.length) {
    throw new Error("CONFORMANCE_SSIM_FRAME_INVALID");
  }
  const rows = Array.from({length: policy.windowSize}, () => new Float64Array(width * moments));
  const rowIds = new Int32Array(policy.windowSize).fill(-1);
  const luminancePreview = new Float64Array(width);
  const luminanceRender = new Float64Array(width);
  const horizontal = (rowIndex: number) => {
    const slot = rowIndex % policy.windowSize;
    if (rowIds[slot] === rowIndex) return rows[slot]!;
    for (let column = 0; column < width; column++) {
      const offset = (rowIndex * width + column) * channels;
      if (channels === 4 && (preview[offset + 3] !== 255 || rendered[offset + 3] !== 255)) {
        throw new Error("CONFORMANCE_SSIM_NON_OPAQUE_FRAME");
      }
      luminancePreview[column] = preview[offset]! * policy.luminanceWeights[0]
        + preview[offset + 1]! * policy.luminanceWeights[1] + preview[offset + 2]! * policy.luminanceWeights[2];
      luminanceRender[column] = rendered[offset]! * policy.luminanceWeights[0]
        + rendered[offset + 1]! * policy.luminanceWeights[1] + rendered[offset + 2]! * policy.luminanceWeights[2];
    }
    const output = rows[slot]!; output.fill(0);
    for (let column = 0; column < width; column++) {
      const base = column * moments;
      for (let tap = 0; tap < weights.length; tap++) {
        const sourceColumn = Math.max(0, Math.min(width - 1, column + tap - radius));
        const left = luminancePreview[sourceColumn]!; const right = luminanceRender[sourceColumn]!; const weight = weights[tap]!;
        output[base]! += weight * left; output[base + 1]! += weight * right;
        output[base + 2]! += weight * left * left; output[base + 3]! += weight * right * right;
        output[base + 4]! += weight * left * right;
      }
    }
    rowIds[slot] = rowIndex; return output;
  };
  const c1 = (policy.k1 * policy.dynamicRange) ** 2;
  const c2 = (policy.k2 * policy.dynamicRange) ** 2;
  let total = 0;
  for (let row = 0; row < height; row++) {
    // At most 11 distinct rows: constructing this view cannot evict a row still used in this window.
    const window = weights.map((_, tap) => horizontal(Math.max(0, Math.min(height - 1, row + tap - radius))));
    for (let column = 0; column < width; column++) {
      let meanLeft = 0, meanRight = 0, squareLeft = 0, squareRight = 0, product = 0;
      const base = column * moments;
      for (let tap = 0; tap < weights.length; tap++) {
        const values = window[tap]!; const weight = weights[tap]!;
        meanLeft += weight * values[base]!; meanRight += weight * values[base + 1]!;
        squareLeft += weight * values[base + 2]!; squareRight += weight * values[base + 3]!;
        product += weight * values[base + 4]!;
      }
      const varianceLeft = Math.max(0, squareLeft - meanLeft * meanLeft);
      const varianceRight = Math.max(0, squareRight - meanRight * meanRight);
      const covariance = product - meanLeft * meanRight;
      const score = ((2 * meanLeft * meanRight + c1) * (2 * covariance + c2))
        / ((meanLeft * meanLeft + meanRight * meanRight + c1) * (varianceLeft + varianceRight + c2));
      total += Math.max(-1, Math.min(1, score));
    }
  }
  const result = total / (width * height);
  if (!Number.isFinite(result)) throw new Error("CONFORMANCE_SSIM_NON_FINITE");
  return result;
}

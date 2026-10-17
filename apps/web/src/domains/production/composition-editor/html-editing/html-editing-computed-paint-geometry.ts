import type { HtmlComputedLayoutPolicy } from "./html-editing-computed-layout-policy";

export type HtmlComputedMatrix = { a: number; b: number; c: number; d: number; e: number; f: number; is2D?: boolean };
export type HtmlComputedRectangle = { x: number; y: number; width: number; height: number };

/** Pure, dependency-free factory embedded in the existing compiled runtime.
 * The reference matrix is compiler-owned, not a source SVG whose own viewBox
 * could cancel malicious amplification. Screen AABBs are conservative bounds;
 * source/native bytes are never clamped or rewritten. Not pixel attestation. */
export function createHtmlComputedPaintGeometry(policy: HtmlComputedLayoutPolicy) {
  const reject = (): never => { throw new Error("HTML_COMPUTED_PAINT_REJECTED"); };
  const matrix = (value: HtmlComputedMatrix): HtmlComputedMatrix => {
    if (!value || value.is2D === false || ![value.a, value.b, value.c, value.d, value.e, value.f].every(Number.isFinite)) reject();
    return value;
  };
  const inverse = (input: HtmlComputedMatrix): HtmlComputedMatrix => {
    const value = matrix(input), determinant = value.a * value.d - value.b * value.c;
    if (!Number.isFinite(determinant) || determinant === 0) return reject();
    return matrix({ a: value.d / determinant, b: -value.b / determinant, c: -value.c / determinant, d: value.a / determinant,
      e: (value.c * value.f - value.d * value.e) / determinant, f: (value.b * value.e - value.a * value.f) / determinant });
  };
  const multiply = (left: HtmlComputedMatrix, right: HtmlComputedMatrix): HtmlComputedMatrix => {
    matrix(left); matrix(right);
    return matrix({ a: left.a * right.a + left.c * right.b, b: left.b * right.a + left.d * right.b,
      c: left.a * right.c + left.c * right.d, d: left.b * right.c + left.d * right.d,
      e: left.a * right.e + left.c * right.f + left.e, f: left.b * right.e + left.d * right.f + left.f });
  };
  const scale = (input: HtmlComputedMatrix) => {
    const value = matrix(input);
    // Largest singular value, including shear/nonuniform scale. Frobenius norm
    // would incorrectly assign sqrt(2) to a native-normalized identity matrix.
    const first = value.a * value.a + value.b * value.b, second = value.c * value.c + value.d * value.d;
    const cross = value.a * value.c + value.b * value.d;
    const amount = Math.sqrt((first + second + Math.hypot(first - second, 2 * cross)) / 2);
    if (!Number.isFinite(amount)) return reject();
    return amount;
  };
  const rectangle = (box: HtmlComputedRectangle, transform: HtmlComputedMatrix, expansion = 0) => {
    matrix(transform);
    if (!box || ![box.x, box.y, box.width, box.height, expansion].every(Number.isFinite)
      || box.width < 0 || box.height < 0 || expansion < 0) return reject();
    const points = [[box.x, box.y], [box.x + box.width, box.y],
      [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) =>
      [transform.a * x + transform.c * y + transform.e, transform.b * x + transform.d * y + transform.f]);
    if (points.some(point => point.some(amount => !Number.isFinite(amount)
      || Math.abs(amount) + expansion > policy.maximumPixels + policy.measurementTolerance))) reject();
    const width = Math.max(...points.map(point => point[0])) - Math.min(...points.map(point => point[0]));
    const height = Math.max(...points.map(point => point[1])) - Math.min(...points.map(point => point[1]));
    if (width + 2 * expansion > policy.maximumPixels + policy.measurementTolerance
      || height + 2 * expansion > policy.maximumPixels + policy.measurementTolerance) reject();
  };
  const svg = (input: { screenMatrix: HtmlComputedMatrix; referenceInverse: HtmlComputedMatrix; box: HtmlComputedRectangle;
    strokePixels: number; miterLimit: number }) => {
    const local = multiply(input.referenceInverse, input.screenMatrix), magnitude = scale(local);
    if (magnitude > policy.maximumSvgScale + policy.measurementTolerance || !Number.isFinite(input.strokePixels) || input.strokePixels < 0
      || !Number.isFinite(input.miterLimit) || input.miterLimit < 1 || input.miterLimit > policy.maximumStrokeMiterLimit) reject();
    // Cover ordinary and non-scaling strokes conservatively. BBox is fill-only;
    // a zero fill box does not exempt a wide stroke from admission.
    const strokeExpansion = input.strokePixels * input.miterLimit * Math.max(1, magnitude) / 2;
    rectangle(input.box, local, strokeExpansion);
  };
  return Object.freeze({ inverse, multiply, rectangle, svg });
}

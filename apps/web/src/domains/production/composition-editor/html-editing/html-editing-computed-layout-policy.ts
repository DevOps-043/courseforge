import { HTML_EDITING_GEOMETRY_POLICY as geometry } from "./html-editing-geometry-policy";

/** Measurements from a trusted browser session, not grants or an execution
 * attestation. This check runs after layout; independent process quotas remain
 * necessary to bound the work that obtaining a measurement can itself require. */
export const HTML_COMPUTED_LAYOUT_POLICY = Object.freeze({
  maximumElements: 16_384, maximumNodes: 32_768, maximumFragments: 65_536, maximumFragmentsPerElement: 512,
  maximumPixels: geometry.maximumPixels, maximumFontPixels: geometry.maximumFontPixels,
  maximumLineHeightPixels: geometry.maximumFontPixels * geometry.maximumLineHeight,
  maximumSvgScale: geometry.maximumSvgScale, maximumStrokeMiterLimit: geometry.maximumStrokeMiterLimit,
  maximumEffectPixels: geometry.maximumEffectPixels,
  measurementTolerance: 0.000001,
  maximumTrackCharacters: 65_536, maximumTracks: 128, maximumCells: 4096,
  resourceTimeoutMilliseconds: 30_000,
});
export type HtmlComputedLayoutPolicy = typeof HTML_COMPUTED_LAYOUT_POLICY;
export type HtmlComputedElementGeometry = {
  lengths: readonly number[]; fontPixels: number; lineHeightPixels: number | null;
  scrollWidth: number; scrollHeight: number; fragments: number;
  gridColumns: number; gridRows: number;
};

/** Dependency-free so the same validator can be embedded in both compiler
 * targets. Counts and values are resolved measurements, not authored tokens. */
export function assertHtmlComputedElementGeometry(value: HtmlComputedElementGeometry, policy: HtmlComputedLayoutPolicy): void {
  const reject = () => { throw new Error("HTML_COMPUTED_LAYOUT_REJECTED"); };
  if (!value.lengths.every(amount => Number.isFinite(amount) && Math.abs(amount) <= policy.maximumPixels)
    || !Number.isFinite(value.fontPixels) || value.fontPixels < 0 || value.fontPixels > policy.maximumFontPixels
    || (value.lineHeightPixels !== null && (!Number.isFinite(value.lineHeightPixels)
      || value.lineHeightPixels < 0 || value.lineHeightPixels > policy.maximumLineHeightPixels))
    || ![value.scrollWidth, value.scrollHeight].every(amount => Number.isFinite(amount) && amount >= 0 && amount <= policy.maximumPixels)
    || !Number.isSafeInteger(value.fragments) || value.fragments < 0 || value.fragments > policy.maximumFragmentsPerElement
    || ![value.gridColumns, value.gridRows].every(count => Number.isSafeInteger(count) && count >= 0 && count <= policy.maximumTracks)
    || value.gridColumns * value.gridRows > policy.maximumCells) reject();
}

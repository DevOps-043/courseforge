export interface CompositionPreviewServerTimings {
  assetsMs: number;
  authorizationMs: number;
  compileMs: number;
  documentMs: number;
  totalMs: number;
}

export interface CompositionPreviewAssetDiagnostics {
  assetCount: number;
  assetQueryMs: number;
  draftLinkQueryMs: number;
  privateAssetCount: number;
  publicAssetCount: number;
  signingMs: number;
}

export function elapsedMilliseconds(startedAt: number, endedAt = performance.now()) {
  return Math.max(0, endedAt - startedAt);
}

export function formatServerTimingHeader(timings: CompositionPreviewServerTimings) {
  return [
    ["authorization", timings.authorizationMs],
    ["document", timings.documentMs],
    ["assets", timings.assetsMs],
    ["compile", timings.compileMs],
    ["total", timings.totalMs],
  ].map(([name, duration]) => `${name};dur=${Number(duration).toFixed(1)}`).join(", ");
}

export function createPreviewCorrelationId(rawValue: string | null) {
  return rawValue && /^[a-zA-Z0-9_-]{8,80}$/.test(rawValue)
    ? rawValue
    : crypto.randomUUID();
}

export const COMPOSITION_PREVIEW_MAX_GENERATION = 2_147_483_647;

export function isCompositionDocumentHash(value: string) {
  return /^[a-f0-9]{64}$/i.test(value);
}

/** Navigation generation is a correlation token, not an authorization secret. */
export function parseCompositionPreviewGeneration(value: string | null): number | null {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation <= COMPOSITION_PREVIEW_MAX_GENERATION ? generation : null;
}

export function readCompositionPreviewGeneration(url: string): number | null {
  try {
    return parseCompositionPreviewGeneration(new URL(url, "https://preview.invalid").searchParams.get("r"));
  } catch {
    return null;
  }
}

export function matchesCompositionPreviewNavigation(input: {
  expectedDocumentHash: string | null;
  expectedGeneration: number;
  receivedDocumentHash: string | null | undefined;
  receivedGeneration: number | null | undefined;
}) {
  return input.expectedDocumentHash !== null
    && input.receivedDocumentHash === input.expectedDocumentHash
    && input.receivedGeneration === input.expectedGeneration;
}

/** Pins the iframe to the exact saved document revision instead of the moving latest pointer. */
export function buildCompositionVersionedPreviewUrl(params: { draftId: string; documentHash: string; refreshKey: number | string }) {
  return `/api/production/hyperframes/drafts/${encodeURIComponent(params.draftId)}/preview?documentHash=${encodeURIComponent(params.documentHash)}&r=${encodeURIComponent(String(params.refreshKey))}`;
}

export function buildCompositionSavedPreviewUrl(params: { draftId: string; documentHash: string; refreshKey: number; strictSyncEnabled: boolean }) {
  if (params.strictSyncEnabled) return `${buildCompositionVersionedPreviewUrl(params)}&sync=2`;
  return `/api/production/hyperframes/drafts/${encodeURIComponent(params.draftId)}/preview?v=${encodeURIComponent(params.documentHash)}&r=${params.refreshKey}`;
}

export function buildCompositionComparisonPreviewUrl(params: { draftId: string; documentHash: string }) {
  return buildCompositionVersionedPreviewUrl({ ...params, refreshKey: params.documentHash });
}

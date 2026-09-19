export function isCompositionDocumentHash(value: string) {
  return /^[a-f0-9]{64}$/i.test(value);
}

export function buildCompositionComparisonPreviewUrl(params: { draftId: string; documentHash: string }) {
  return `/api/production/hyperframes/drafts/${params.draftId}/preview?documentHash=${encodeURIComponent(params.documentHash)}&r=${encodeURIComponent(params.documentHash)}`;
}

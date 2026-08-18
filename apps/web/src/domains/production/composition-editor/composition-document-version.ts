const DOCUMENT_HASH_PATTERN = /^[a-f0-9]{64}$/i;

/**
 * The editor's strong ETag is the SHA-256 hash of the persisted document.
 * Weak ETags and lists are intentionally unsupported because a save must name
 * one exact immutable document version.
 */
export function parseCompositionDocumentEtag(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^"([a-f0-9]{64})"$/i.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

export function formatCompositionDocumentEtag(documentHash: string): string {
  const normalizedHash = normalizeCompositionDocumentHash(documentHash);
  if (!normalizedHash) throw new Error("La versión del documento no tiene un formato válido.");
  return `"${normalizedHash}"`;
}

export function normalizeCompositionDocumentHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalizedHash = value.trim().toLowerCase();
  return DOCUMENT_HASH_PATTERN.test(normalizedHash) ? normalizedHash : null;
}

export function resolveCompositionDocumentVersion(params: {
  bodyDocumentHash: unknown;
  responseEtag: string | null;
}): string {
  const bodyDocumentHash = normalizeCompositionDocumentHash(params.bodyDocumentHash);
  const responseEtag = parseCompositionDocumentEtag(params.responseEtag);

  if (!bodyDocumentHash || !responseEtag || bodyDocumentHash !== responseEtag) {
    throw new Error("La respuesta del documento no incluyó una versión válida y consistente. Recarga el editor.");
  }
  return responseEtag;
}

/** Produces a safe diagnostic value without persisting a whole content hash. */
export function describeCompositionDocumentVersion(value: string | null | undefined): string {
  const normalizedHash = normalizeCompositionDocumentHash(value);
  return normalizedHash ? `${normalizedHash.slice(0, 12)}…` : "invalid-or-missing";
}

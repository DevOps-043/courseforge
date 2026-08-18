const DOCUMENT_HASH_PATTERN = /^[a-f0-9]{64}$/i;

export const COMPOSITION_VERSION_FALLBACK_HEADER = "x-composition-version";

export type CompositionDocumentPreconditionResolution =
  | { documentHash: string; ok: true; source: "IF_MATCH" | "X_COMPOSITION_VERSION" }
  | { ok: false; reason: "INVALID" | "MISMATCH" | "MISSING" };

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

/**
 * Netlify may handle standard conditional headers before a Next.js route sees
 * the request. Send the same non-secret version through a custom header as a
 * transport fallback, while rejecting malformed or contradictory values.
 */
export function resolveCompositionDocumentPrecondition(params: {
  fallbackHeader: string | null | undefined;
  ifMatchHeader: string | null | undefined;
}): CompositionDocumentPreconditionResolution {
  const hasIfMatch = Boolean(params.ifMatchHeader?.trim());
  const hasFallback = Boolean(params.fallbackHeader?.trim());
  if (!hasIfMatch && !hasFallback) return { ok: false, reason: "MISSING" };

  const ifMatchHash = hasIfMatch ? parseCompositionDocumentEtag(params.ifMatchHeader) : null;
  const fallbackHash = hasFallback ? normalizeCompositionDocumentHash(params.fallbackHeader) : null;
  if ((hasIfMatch && !ifMatchHash) || (hasFallback && !fallbackHash)) {
    return { ok: false, reason: "INVALID" };
  }
  if (ifMatchHash && fallbackHash && ifMatchHash !== fallbackHash) {
    return { ok: false, reason: "MISMATCH" };
  }
  if (ifMatchHash) return { documentHash: ifMatchHash, ok: true, source: "IF_MATCH" };
  return { documentHash: fallbackHash!, ok: true, source: "X_COMPOSITION_VERSION" };
}

export function normalizeCompositionDocumentHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalizedHash = value.trim().toLowerCase();
  return DOCUMENT_HASH_PATTERN.test(normalizedHash) ? normalizedHash : null;
}

/**
 * The JSON representation is the client-facing concurrency contract. CDNs may
 * generate, normalize, or remove HTTP ETags for dynamic responses, so a
 * response ETag must never prevent the editor from using its persisted hash.
 */
export function resolveCompositionDocumentVersion(bodyDocumentHash: unknown): string {
  const normalizedDocumentHash = normalizeCompositionDocumentHash(bodyDocumentHash);
  if (!normalizedDocumentHash) {
    throw new Error("La respuesta del documento no incluyó una versión válida. Recarga el editor.");
  }
  return normalizedDocumentHash;
}

/** Produces a safe diagnostic value without persisting a whole content hash. */
export function describeCompositionDocumentVersion(value: string | null | undefined): string {
  const normalizedHash = normalizeCompositionDocumentHash(value);
  return normalizedHash ? `${normalizedHash.slice(0, 12)}…` : "invalid-or-missing";
}

import { normalizeSourceUrl, validateUrlSource } from "./validation";
import type { CurationCandidate, UrlValidationResult } from "./types";
const DEFAULT_SOURCES_PER_LESSON = 2;

export async function validateAutomaticCandidates(params: {
  candidates: CurationCandidate[];
  existingNormalizedUrls: Set<string>;
  validate?: (
    url: string,
    options: { existingNormalizedUrls: Iterable<string> },
  ) => Promise<UrlValidationResult>;
  limit?: number;
  shouldContinue?: () => Promise<boolean>;
  onAccepted?: (item: { candidate: CurationCandidate; validation: UrlValidationResult }) => Promise<boolean>;
  onRejected?: (reason: "INVALID_URL" | "DUPLICATE" | "INVALID_SOURCE") => void;
}) {
  const {
    candidates,
    existingNormalizedUrls,
    validate = validateUrlSource,
    limit = DEFAULT_SOURCES_PER_LESSON,
  } = params;
  const selected: Array<{
    candidate: CurationCandidate;
    validation: UrlValidationResult;
  }> = [];

  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (params.shouldContinue && !await params.shouldContinue()) break;
    let candidateUrl: string;
    try {
      candidateUrl = normalizeSourceUrl(candidate.url);
    } catch {
      params.onRejected?.("INVALID_URL");
      continue;
    }
    if (existingNormalizedUrls.has(candidateUrl)) { params.onRejected?.("DUPLICATE"); continue; }
    const validation = await validate(candidate.url, {
      existingNormalizedUrls,
    });
    // Excluye en las rondas siguientes tanto candidatos rechazados como sus destinos.
    const resolvedUrl = validation.normalizedUrl || candidateUrl;
    const duplicateDestination = existingNormalizedUrls.has(resolvedUrl);
    existingNormalizedUrls.add(candidateUrl);
    existingNormalizedUrls.add(resolvedUrl);
    if (!validation.isValid || duplicateDestination) {
      params.onRejected?.(duplicateDestination ? "DUPLICATE" : "INVALID_SOURCE");
      continue;
    }
    if (params.onAccepted && !await params.onAccepted({ candidate, validation })) break;
    selected.push({ candidate, validation });
  }
  return selected;
}


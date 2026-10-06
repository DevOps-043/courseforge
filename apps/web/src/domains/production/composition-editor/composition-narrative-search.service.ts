import type { CompositionSceneSummary } from "./composition-scene.service";
import type { NarrativeNavigationOccurrence } from "./composition-narrative-occurrence.service";

export const NARRATIVE_SEARCH_LIMITS = Object.freeze({
  queryCharacters: 256,
  indexedCharacters: 200_000,
  results: 50,
  contextCharacters: 40,
});

type SearchField = "TITLE" | "SCRIPT" | "TIMED_WORDS";
interface IndexedNarrativeText {
  sceneId: string;
  sceneLabel: string;
  primaryHfId: string;
  startSeconds: number;
  field: SearchField;
  original: string;
  normalized: string;
  offsets: readonly { start: number; end: number }[];
  occurrence?: NarrativeNavigationOccurrence;
}
export interface NarrativeSearchIndex {
  entries: readonly IndexedNarrativeText[];
  incomplete: boolean;
  ignoreAccents: boolean;
}
export interface NarrativeSearchMatch {
  id: string;
  sceneId: string;
  sceneLabel: string;
  primaryHfId: string;
  sceneStartSeconds: number;
  navigationSeconds: number;
  occurrenceId?: string;
  tokenRange?: { firstSourceIndex: number; lastSourceIndex: number; partial: boolean };
  field: SearchField;
  before: string;
  matched: string;
  after: string;
}
export interface NarrativeSearchResponse {
  matches: readonly NarrativeSearchMatch[];
  limited: boolean;
  incomplete: boolean;
  queryTooLong: boolean;
}

// Keep ñ distinct from n; optional accent folding applies only to vowel marks.
function normalizeGrapheme(grapheme: string, ignoreAccents: boolean): string {
  const canonical = grapheme.normalize("NFC").toLowerCase();
  return ignoreAccents
    ? canonical.normalize("NFD").replace(/([aeiou])\p{M}+/gu, "$1").normalize("NFC")
    : canonical;
}

function normalizeText(text: string, ignoreAccents: boolean) {
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
  let normalized = "";
  const offsets: { start: number; end: number }[] = [];
  for (const segment of segments) {
    const folded = normalizeGrapheme(segment.segment, ignoreAccents);
    normalized += folded;
    for (let unit = 0; unit < folded.length; unit += 1) {
      offsets.push({ start: segment.index, end: segment.index + segment.segment.length });
    }
  }
  return { normalized, offsets };
}

/** Read-only index of authored text. Scene times are navigation hints, not extraction authority. */
export function buildNarrativeSearchIndex(
  scenes: readonly CompositionSceneSummary[],
  options: { sceneId?: string; ignoreAccents?: boolean; occurrences?: readonly NarrativeNavigationOccurrence[] } = {},
): NarrativeSearchIndex {
  const entries: IndexedNarrativeText[] = [];
  let remainingCharacters = NARRATIVE_SEARCH_LIMITS.indexedCharacters;
  let incomplete = false;
  for (const scene of scenes) {
    if (options.sceneId && scene.id !== options.sceneId) continue;
    for (const [field, original] of [["TITLE", scene.label], ["SCRIPT", scene.scriptText || ""]] as const) {
      if (!original) continue;
      if (original.length > remainingCharacters) { incomplete = true; continue; }
      remainingCharacters -= original.length;
      entries.push({
        sceneId: scene.id, sceneLabel: scene.label, primaryHfId: scene.primaryHfId,
        startSeconds: scene.startSeconds, field, original,
        ...normalizeText(original, options.ignoreAccents ?? true),
      });
    }
    for (const occurrence of options.occurrences || []) {
      if (occurrence.sceneId !== scene.id) continue;
      if (occurrence.text.length > remainingCharacters) { incomplete = true; continue; }
      remainingCharacters -= occurrence.text.length;
      entries.push({ sceneId: scene.id, sceneLabel: scene.label, primaryHfId: occurrence.hfId,
        startSeconds: scene.startSeconds, field: "TIMED_WORDS", original: occurrence.text, occurrence,
        ...normalizeText(occurrence.text, options.ignoreAccents ?? true) });
    }
  }
  return { entries, incomplete, ignoreAccents: options.ignoreAccents ?? true };
}

/** Literal matching only: no regex, HTML, persistence or inferred word timing. */
export function searchNarrativeIndex(
  index: NarrativeSearchIndex,
  query: string,
): NarrativeSearchResponse {
  const response: NarrativeSearchResponse = {
    matches: [], limited: false, incomplete: index.incomplete,
    queryTooLong: query.length > NARRATIVE_SEARCH_LIMITS.queryCharacters,
  };
  if (response.queryTooLong || !query.trim()) return response;
  const needle = normalizeText(query.trim(), index.ignoreAccents).normalized;
  const matches: NarrativeSearchMatch[] = [];
  for (const entry of index.entries) {
    let cursor = 0;
    while (cursor <= entry.normalized.length - needle.length) {
      const position = entry.normalized.indexOf(needle, cursor);
      if (position < 0) break;
      if (matches.length === NARRATIVE_SEARCH_LIMITS.results) {
        return { ...response, matches, limited: true };
      }
      const start = entry.offsets[position]!.start;
      const end = entry.offsets[position + needle.length - 1]!.end;
      const selectedTokens = entry.occurrence?.tokens.filter((token) => token.textStart < end && token.textEnd > start);
      const firstToken = selectedTokens?.[0];
      const lastToken = selectedTokens?.at(-1);
      matches.push({
        id: JSON.stringify([entry.sceneId, entry.field, entry.occurrence?.id, start, end]),
        sceneId: entry.sceneId, sceneLabel: entry.sceneLabel, primaryHfId: entry.primaryHfId,
        sceneStartSeconds: entry.startSeconds, field: entry.field,
        navigationSeconds: firstToken?.timelineStartSeconds ?? entry.startSeconds,
        occurrenceId: entry.occurrence?.id,
        tokenRange: firstToken && lastToken ? { firstSourceIndex: firstToken.sourceIndex,
          lastSourceIndex: lastToken.sourceIndex, partial: selectedTokens!.some((token) => token.partial) } : undefined,
        before: entry.original.slice(Math.max(0, start - NARRATIVE_SEARCH_LIMITS.contextCharacters), start),
        matched: entry.original.slice(start, end),
        after: entry.original.slice(end, end + NARRATIVE_SEARCH_LIMITS.contextCharacters),
      });
      cursor = position + needle.length;
    }
  }
  return { ...response, matches };
}

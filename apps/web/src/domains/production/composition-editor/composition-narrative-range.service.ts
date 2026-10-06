import type { CompositionEditorDocument } from "./composition-document.types";
import { deriveNarrativeNavigationOccurrences } from "./composition-narrative-occurrence.service";

export const NARRATIVE_RANGE_PREVIEW_MAX_SECONDS = 120;
export const NARRATIVE_RANGE_PREVIEW_TIMEOUT_MARGIN_MS = 10_000;
export const NARRATIVE_RANGE_TEXT_PREVIEW_CHARACTERS = 500;

export interface NarrativeRangeSelection {
  documentHash: string;
  occurrenceId: string;
  firstSourceIndex: number;
  lastSourceIndex: number;
  adjustedStartSeconds?: number;
  adjustedEndSeconds?: number;
}
export interface NarrativeRangePreview {
  selection: NarrativeRangeSelection;
  hfId: string;
  clipId: string;
  startSeconds: number;
  endSeconds: number;
  partial: boolean;
  text: string;
}
export type NarrativeRangeResolution =
  | { ok: true; range: NarrativeRangePreview }
  | { ok: false; reason: "STALE_DOCUMENT" | "MISSING_OCCURRENCE" | "INVALID_TOKENS" | "INVALID_INTERVAL" | "RANGE_TOO_LONG" };

/** Rebuild from the current document; navigation metadata never authorizes extraction. */
export function resolveNarrativeRangePreview(
  document: CompositionEditorDocument,
  documentHash: string,
  selection: NarrativeRangeSelection,
): NarrativeRangeResolution {
  if (!documentHash || selection.documentHash !== documentHash) return { ok: false, reason: "STALE_DOCUMENT" };
  if (!Number.isInteger(selection.firstSourceIndex) || !Number.isInteger(selection.lastSourceIndex)
    || selection.firstSourceIndex < 0 || selection.lastSourceIndex < selection.firstSourceIndex) {
    return { ok: false, reason: "INVALID_TOKENS" };
  }
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences.find((candidate) => candidate.id === selection.occurrenceId);
  if (!occurrence) return { ok: false, reason: "MISSING_OCCURRENCE" };
  const tokens = occurrence.tokens.filter((token) => token.sourceIndex >= selection.firstSourceIndex && token.sourceIndex <= selection.lastSourceIndex);
  const first = tokens[0];
  const last = tokens.at(-1);
  if (!first || !last || first.sourceIndex !== selection.firstSourceIndex || last.sourceIndex !== selection.lastSourceIndex
    || tokens.length !== selection.lastSourceIndex - selection.firstSourceIndex + 1) {
    return { ok: false, reason: "INVALID_TOKENS" };
  }
  const clip = document.clips.find((candidate) => candidate.id === occurrence.clipId)!;
  const adjusted = selection.adjustedStartSeconds !== undefined || selection.adjustedEndSeconds !== undefined;
  const startSeconds = adjusted ? selection.adjustedStartSeconds! : first.timelineStartSeconds;
  const endSeconds = adjusted ? selection.adjustedEndSeconds! : last.timelineEndSeconds;
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds
    || startSeconds < clip.startSeconds || endSeconds > clip.startSeconds + clip.durationSeconds) {
    return { ok: false, reason: "INVALID_INTERVAL" };
  }
  if (endSeconds - startSeconds > NARRATIVE_RANGE_PREVIEW_MAX_SECONDS) {
    return { ok: false, reason: "RANGE_TOO_LONG" };
  }
  return { ok: true, range: { selection: { ...selection }, hfId: occurrence.hfId, clipId: occurrence.clipId,
    startSeconds, endSeconds,
    text: occurrence.text.slice(first.textStart, last.textEnd), partial: tokens.some((token) => token.partial) } };
}

/** Evaluated only on accepted transport time messages, not on a guessed wall-clock playhead. */
export function shouldStopNarrativeRangePreview(range: NarrativeRangePreview, documentHash: string | null, seconds: number): boolean {
  return range.selection.documentHash !== documentHash || !Number.isFinite(seconds)
    || seconds < range.startSeconds || seconds >= range.endSeconds;
}

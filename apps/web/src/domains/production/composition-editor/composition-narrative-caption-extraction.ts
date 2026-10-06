import { z } from "zod";
import { compositionNativeCaptionSourceSchema } from "./composition-text-layer.types";

type CaptionSource = z.infer<typeof compositionNativeCaptionSourceSchema>;
export type NarrativeCaptionExtractionWarning = { cueId: string; kind: "CUE_CUT" | "WORD_CUT"; wordId?: string };
export type NarrativeCaptionExtractionResult = { source: CaptionSource | null; warnings: NarrativeCaptionExtractionWarning[] };

/** Local clip times. Preserve authored cue text/style/origin; clipping is not transcript regeneration. */
export function extractNarrativeCaptionInterval(params: {
  source: CaptionSource; startSeconds: number; endSeconds: number; commandId: string; clipOrdinal: number;
}): NarrativeCaptionExtractionResult {
  const source = compositionNativeCaptionSourceSchema.parse(params.source);
  const interval = z.object({ startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().positive(),
    commandId: z.string().uuid(), clipOrdinal: z.number().int().nonnegative().max(100) }).parse(params);
  if (interval.endSeconds <= interval.startSeconds) throw new Error("Invalid caption extraction interval");
  const warnings: NarrativeCaptionExtractionWarning[] = [];
  const cues: CaptionSource["cues"] = [];
  source.cues.forEach((cue, cueOrdinal) => {
    const start = Math.max(interval.startSeconds, cue.startSeconds);
    const end = Math.min(interval.endSeconds, cue.endSeconds);
    if (end <= start) return;
    if (start !== cue.startSeconds || end !== cue.endSeconds) warnings.push({ cueId: cue.id, kind: "CUE_CUT" });
    const prefix = `caption-${interval.commandId}-${interval.clipOrdinal}-${cueOrdinal}`;
    const copied = { ...structuredClone(cue), id: prefix,
      startSeconds: start - interval.startSeconds, endSeconds: end - interval.startSeconds };
    if (cue.words) {
      copied.words = cue.words.flatMap((word, wordOrdinal) => {
        const wordStart = Math.max(start, word.startSeconds);
        const wordEnd = Math.min(end, word.endSeconds);
        if (wordEnd <= wordStart) return [];
        if (wordStart !== word.startSeconds || wordEnd !== word.endSeconds) warnings.push({ cueId: cue.id, wordId: word.id, kind: "WORD_CUT" });
        return [{ ...word, id: `${prefix}-word-${wordOrdinal}`, startSeconds: wordStart - interval.startSeconds, endSeconds: wordEnd - interval.startSeconds }];
      });
    }
    cues.push(copied);
  });
  if (!cues.length) return { source: null, warnings };
  return { source: compositionNativeCaptionSourceSchema.parse({ ...source, cues }), warnings };
}

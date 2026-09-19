import type { CompositionEditorDocument } from "./composition-document.types";
import { createCompositionNativeOverlay } from "./composition-native-overlay.factory";
import type { CompositionSceneSummary } from "./composition-scene.service";
import type { CompositionCaptionCue } from "./composition-text-layer.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";

const MAX_WORDS_PER_CUE = 5;
const MAX_CHARACTERS_PER_CUE = 80;
const NATURAL_PAUSE_SECONDS = 0.15;
const MAX_MUSIC_TOKEN_RATIO = 0.2;

export class CompositionTranscriptCaptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositionTranscriptCaptionError";
  }
}

type TranscriptWord = { end: number; start: number; word: string };

export function buildCompositionTranscriptCaptionCues(params: {
  durationSeconds: number;
  scenes: CompositionSceneSummary[];
}) {
  if (!Number.isFinite(params.durationSeconds) || params.durationSeconds <= 0) {
    throw new CompositionTranscriptCaptionError("La composición no tiene una duración válida para captions.");
  }
  const rawWords = params.scenes.flatMap((scene) => scene.wordCues || []);
  if (rawWords.length === 0) {
    throw new CompositionTranscriptCaptionError("Las voces actuales no contienen timestamps por palabra.");
  }
  const musicTokenCount = rawWords.filter((word) => isMusicToken(word.word)).length;
  if (musicTokenCount / rawWords.length > MAX_MUSIC_TOKEN_RATIO) {
    throw new CompositionTranscriptCaptionError("Los timestamps contienen demasiado ruido o música para generar captions confiables.");
  }

  const words = deduplicateWords(rawWords)
    .flatMap((word) => normalizeWord(word, params.durationSeconds))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  if (words.length === 0) {
    throw new CompositionTranscriptCaptionError("No quedaron palabras válidas después del control de calidad.");
  }

  const groups: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const next = words[index + 1];
    const prospectiveText = captionText([...current, word]);
    if (current.length > 0 && prospectiveText.length > MAX_CHARACTERS_PER_CUE) {
      groups.push(current);
      current = [];
    }
    current.push(word);
    const pauseAfter = next ? next.start - word.end : Number.POSITIVE_INFINITY;
    if (current.length >= MAX_WORDS_PER_CUE || endsPhrase(word.word) || pauseAfter >= NATURAL_PAUSE_SECONDS) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);

  const cues = groups.map((group, index): CompositionCaptionCue => {
    normalizeWordBoundaries(group);
    return {
      endSeconds: roundMilliseconds(Math.min(params.durationSeconds, Math.max(...group.map((word) => word.end)))),
      id: `transcript-cue-${index + 1}`,
      startSeconds: roundMilliseconds(Math.max(0, Math.min(...group.map((word) => word.start)))),
      text: captionText(group),
      words: group.map((word, wordIndex) => ({
        endSeconds: roundMilliseconds(word.end),
        id: `word-${wordIndex + 1}`,
        startSeconds: roundMilliseconds(word.start),
        text: word.word,
      })),
    };
  });
  normalizeCueBoundaries(cues);
  return cues;
}

export function createCompositionTranscriptCaptionPlan(params: {
  document: CompositionEditorDocument;
  id: string;
  scenes: CompositionSceneSummary[];
}) {
  const cues = buildCompositionTranscriptCaptionCues({
    durationSeconds: params.document.canvas.durationSeconds,
    scenes: params.scenes,
  });
  const captionLayers = params.document.clips.filter((clip) => clip.source.type === "NATIVE_CAPTIONS");
  const transcriptLayers = captionLayers.filter((clip) => clip.source.type === "NATIVE_CAPTIONS" && clip.source.origin === "TRANSCRIPT");
  if (captionLayers.length > transcriptLayers.length) {
    throw new CompositionTranscriptCaptionError(
      "Ya existe una capa manual o importada de captions. Retírala antes de generar captions desde la voz.",
    );
  }
  if (transcriptLayers.length > 1) {
    throw new CompositionTranscriptCaptionError("La composición contiene más de una capa de captions generados.");
  }

  const existing = transcriptLayers[0];
  if (existing) {
    const operations: CompositionEditorPatchOperation[] = [{
      clipId: existing.id,
      cues,
      origin: "TRANSCRIPT",
      type: "clip.caption-cues",
    }, {
      clipId: existing.id,
      durationSeconds: params.document.canvas.durationSeconds,
      layout: existing.layout,
      startSeconds: 0,
      timingSource: "USER_EDITED",
      type: "clip.template",
    }];
    return { cueCount: cues.length, hfId: existing.hfId, mode: "UPDATE" as const, operations };
  }

  const { clip, track } = createCompositionNativeOverlay({
    document: params.document,
    id: params.id,
    kind: "CAPTION",
    playheadSeconds: 0,
  });
  clip.durationSeconds = params.document.canvas.durationSeconds;
  clip.label = "Captions de voz";
  clip.startSeconds = 0;
  if (clip.source.type !== "NATIVE_CAPTIONS") {
    throw new CompositionTranscriptCaptionError("No se pudo crear una capa nativa de captions.");
  }
  clip.source.cues = cues;
  clip.source.origin = "TRANSCRIPT";
  const operations: CompositionEditorPatchOperation[] = [{
    clip,
    clipId: clip.id,
    ...(track ? { track } : {}),
    type: "clip.add",
  }];
  return { cueCount: cues.length, hfId: clip.hfId, mode: "CREATE" as const, operations };
}

function normalizeWord(word: TranscriptWord, durationSeconds: number): TranscriptWord[] {
  const text = word.word.trim();
  if (!text || isMusicToken(text) || isShortFiller(text, word.end - word.start)) return [];
  if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start) return [];
  if (word.end <= 0 || word.start >= durationSeconds) return [];
  const start = Math.max(0, word.start);
  const end = Math.min(durationSeconds, word.end);
  return end > start ? [{ end, start, word: text }] : [];
}

function deduplicateWords(words: TranscriptWord[]) {
  const seen = new Set<string>();
  return words.filter((word) => {
    const identity = `${word.start.toFixed(3)}:${word.end.toFixed(3)}:${word.word.trim().toLowerCase()}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function normalizeCueBoundaries(cues: CompositionCaptionCue[]) {
  for (let index = 1; index < cues.length; index += 1) {
    const previous = cues[index - 1]!;
    const current = cues[index]!;
    if (current.startSeconds >= previous.endSeconds) continue;
    if (current.startSeconds > previous.startSeconds) previous.endSeconds = current.startSeconds;
    else current.startSeconds = previous.endSeconds;
    if (current.endSeconds <= current.startSeconds) {
      throw new CompositionTranscriptCaptionError("Los timestamps de voz se solapan de forma incompatible.");
    }
  }
}

function normalizeWordBoundaries(words: TranscriptWord[]) {
  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1]!;
    const current = words[index]!;
    if (current.start >= previous.end) continue;
    if (current.start > previous.start) previous.end = current.start;
    else current.start = previous.end;
    if (current.end <= current.start) {
      throw new CompositionTranscriptCaptionError("Los timestamps de una palabra se solapan de forma incompatible.");
    }
  }
}

function captionText(words: TranscriptWord[]) {
  return words.map((word) => word.word).join(" ")
    .replace(/\s+([,.;:!?…])/g, "$1")
    .replace(/([¿¡])\s+/g, "$1");
}

function endsPhrase(word: string) {
  return /[.!?…;:]$/.test(word);
}

function isMusicToken(word: string) {
  return /^[♪♫♬♭♮♯�]+$/.test(word.trim());
}

function isShortFiller(word: string, durationSeconds: number) {
  return /^(huh|uh|um|ah|oh)$/i.test(word) && durationSeconds < 0.1;
}

function roundMilliseconds(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

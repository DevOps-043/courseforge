import type { CompositionCaptionCue } from "./composition-text-layer.types";

export const COMPOSITION_NATIVE_TEXT_DIRECTION = "auto" as const;
export const COMPOSITION_NATIVE_TEXT_BIDI = "plaintext" as const;

export function resolveCompositionTextLanguage(language: string | undefined): string | null {
  if (!language || language.length > 35) return null;
  try { return Intl.getCanonicalLocales(language)[0] || null; } catch { return null; }
}

/** Preserve punctuation, whitespace and adjacent CJK tokens when timed words match the authored cue. */
export function resolveCompositionCaptionWordGaps(cue: CompositionCaptionCue): { prefixes: string[]; suffix: string } | null {
  const prefixes: string[] = [];
  let cursor = 0;
  for (const word of cue.words || []) {
    const index = cue.text.indexOf(word.text, cursor);
    if (index < 0) return null;
    prefixes.push(cue.text.slice(cursor, index));
    cursor = index + word.text.length;
  }
  return { prefixes, suffix: cue.text.slice(cursor) };
}

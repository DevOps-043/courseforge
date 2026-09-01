export const ANIMATED_DECK_APPEARANCES = ["light", "dark"] as const;

export type AnimatedDeckAppearance = typeof ANIMATED_DECK_APPEARANCES[number];

export const DEFAULT_ANIMATED_DECK_APPEARANCE: AnimatedDeckAppearance = "light";

export function normalizeAnimatedDeckAppearance(value: unknown): AnimatedDeckAppearance {
  return value === "dark" ? "dark" : DEFAULT_ANIMATED_DECK_APPEARANCE;
}

export function readAnimatedDeckAppearanceFromHtml(sourceHtml: string): AnimatedDeckAppearance {
  const htmlTag = sourceHtml.match(/<html\b[^>]*>/i)?.[0];
  const match = htmlTag?.match(/\bdata-appearance\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i);
  const appearance = match?.[2] ?? match?.[3];
  return normalizeAnimatedDeckAppearance(appearance);
}

/**
 * Decks prepared before appearance-aware scoping emitted the impossible
 * selector `.deck-scope :root[...]`. Keep the repair at the shared read/render
 * boundary so already persisted decks and composition snapshots remain usable.
 */
export function repairLegacyAnimatedDeckAppearanceSelectors(css: string): string {
  return css.replace(/\.deck-scope\s+:root\b/gi, ".deck-scope");
}

import type { CourseDeckAppearance, CourseDeckSpec } from "../specs/course-deck.schema";

interface CourseDeckTheme {
  accent: string;
  accent2: string;
  background: string;
  backgroundPositive: string;
  chromeRgb: string;
  imagePane: string;
  muted: string;
  surface: string;
  surfaceRgb: string;
  text: string;
}

const SOFLIA_APPEARANCE_TOKENS: Record<CourseDeckAppearance, Omit<CourseDeckTheme, "accent" | "accent2">> = {
  light: {
    background: "#F3F7F8",
    backgroundPositive: "#E8FAF7",
    chromeRgb: "10, 37, 64",
    imagePane: "#E2E8F0",
    muted: "#6C757D",
    surface: "#FFFFFF",
    surfaceRgb: "255, 255, 255",
    text: "#0A2540",
  },
  dark: {
    background: "#0F1419",
    backgroundPositive: "#0A0D12",
    chromeRgb: "255, 255, 255",
    imagePane: "#0A0D12",
    muted: "#CBD5E1",
    surface: "#1E2329",
    surfaceRgb: "30, 35, 41",
    text: "#FFFFFF",
  },
};

/**
 * Resolves structural colors from the approved SofLIA appearance while
 * preserving the template's brand accents. This prevents arbitrary template
 * prompts from producing unreadable light/dark combinations.
 */
export function resolveCourseDeckThemeForAppearance(
  deck: CourseDeckSpec,
  appearance: CourseDeckAppearance,
): CourseDeckTheme {
  const structuralTokens = SOFLIA_APPEARANCE_TOKENS[appearance];

  return {
    ...structuralTokens,
    accent: deck.designSystem.accent || "#00D4B3",
    accent2: appearance === "dark"
      ? "#00D4B3"
      : deck.designSystem.accent2 || "#138A87",
  };
}

export function resolveCourseDeckTheme(deck: CourseDeckSpec): CourseDeckTheme {
  return resolveCourseDeckThemeForAppearance(deck, deck.appearance || "light");
}

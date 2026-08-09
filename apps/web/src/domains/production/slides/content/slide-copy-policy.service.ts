import type { CourseSlideSpec } from "../specs/course-deck.schema";

export interface SlideCopyBudget {
  maxBodyCharacters: number;
  maxBodyItems: number;
  maxBodyItemCharacters: number;
  maxSubtitleCharacters: number;
  maxTitleCharacters: number;
}

const DEFAULT_BUDGET: SlideCopyBudget = {
  maxBodyCharacters: 210,
  maxBodyItems: 3,
  maxBodyItemCharacters: 68,
  maxSubtitleCharacters: 88,
  maxTitleCharacters: 58,
};

const COVER_BUDGET: SlideCopyBudget = {
  maxBodyCharacters: 120,
  maxBodyItems: 1,
  maxBodyItemCharacters: 120,
  maxSubtitleCharacters: 88,
  maxTitleCharacters: 58,
};

const DATA_BUDGET: SlideCopyBudget = {
  maxBodyCharacters: 150,
  maxBodyItems: 2,
  maxBodyItemCharacters: 72,
  maxSubtitleCharacters: 76,
  maxTitleCharacters: 64,
};

/**
 * Visible copy is a visual cue for the narrated lesson, not a transcript.
 * These constraints deliberately sit well below the renderer's technical limits.
 */
export function copyBudgetForSlideType(slideType?: CourseSlideSpec["type"]): SlideCopyBudget {
  if (slideType === "cover" || slideType === "transition") {
    return COVER_BUDGET;
  }

  if (slideType === "data_explainer") {
    return DATA_BUDGET;
  }

  return DEFAULT_BUDGET;
}

export function compactSlideCopy(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function limitSlideCopy(value: unknown, maxLength: number): string {
  const compact = compactSlideCopy(value);
  if (compact.length <= maxLength) {
    return compact;
  }

  const sliced = compact.slice(0, maxLength - 1).trimEnd();
  const wordBreak = sliced.lastIndexOf(" ");
  const breakAt = wordBreak >= Math.floor(maxLength * 0.55) ? wordBreak : sliced.length;
  return `${sliced.slice(0, breakAt).trimEnd()}…`;
}

export function textLengthForVisibleSlide(slide: Pick<CourseSlideSpec, "bodyBlocks" | "subtitle" | "title">) {
  const bodyLength = slide.bodyBlocks.reduce((total, block) => {
    if (block.kind === "bullets") {
      return total + (block.items || []).join(" ").length;
    }
    return total + (block.text || "").length;
  }, 0);

  return bodyLength + slide.title.length + (slide.subtitle?.length || 0);
}

function languageScores(value: string) {
  const tokens = value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z]+/g) || [];
  const spanish = new Set(["de", "del", "la", "las", "el", "los", "para", "con", "una", "que", "como", "aprendizaje", "leccion", "fuente", "puede", "debe"]);
  const english = new Set(["the", "and", "with", "for", "from", "this", "that", "your", "learning", "lesson", "source", "should", "must", "can", "focus"]);
  return tokens.reduce((scores, token) => ({
    spanish: scores.spanish + (spanish.has(token) ? 1 : 0),
    english: scores.english + (english.has(token) ? 1 : 0),
  }), { spanish: 0, english: 0 });
}

/** Detects clear prose in the opposite locale while allowing product and technical terms. */
export function hasUnexpectedVisibleLanguage(value: string, locale: "es" | "en") {
  const scores = languageScores(value);
  const unexpectedScore = locale === "en" ? scores.spanish : scores.english;
  const expectedScore = locale === "en" ? scores.english : scores.spanish;
  return unexpectedScore >= 3 && unexpectedScore >= expectedScore + 2;
}

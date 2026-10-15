import { createHash } from "node:crypto";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";
import { NATIVE_CONFORMANCE_CORPUS_FPS } from "./composition-native-conformance-corpus";
import { buildDeckTextPlan, hashDeckTextPlan } from "../composition-deck-text-plan";

export const DECK_CONFORMANCE_CORPUS_VERSION = 1;
export const DECK_CONFORMANCE_CORPUS_RECIPES = [
  "deck-basic", "deck-wrap", "deck-rtl", "deck-cut", "deck-transform",
] as const;
const DURATION_SECONDS = 8;
const WIDTH = 1920;
const HEIGHT = 1080;
const TEXT = {
  basic: "Deck HTML — Áé 123",
  wrap: "Texto largo del deck para verificar saltos de línea y límites de la caja sin truncamiento silencioso.",
  rtl: "مرحبا بالعالم — 123",
  incoming: "Segundo slide — B",
} as const;
const digest = (content: string) => createHash("sha256").update(content).digest("hex");

/** Authored expectations are independent of DOM capture. This is not measured text evidence. */
export function buildDeckConformanceCorpusCase(recipeId: string, fps: typeof NATIVE_CONFORMANCE_CORPUS_FPS[number]) {
  if (!NATIVE_CONFORMANCE_CORPUS_FPS.includes(fps)) throw new Error("CONFORMANCE_DECK_CORPUS_FPS_INVALID");
  if (!(DECK_CONFORMANCE_CORPUS_RECIPES as readonly string[]).includes(recipeId))
    throw new Error("CONFORMANCE_DECK_CORPUS_RECIPE_UNKNOWN");
  const text = recipeId === "deck-wrap" ? TEXT.wrap : recipeId === "deck-rtl" ? TEXT.rtl : TEXT.basic;
  const expectations = [text, ...(recipeId === "deck-cut" ? [TEXT.incoming] : [])].map((expectedText, index) => ({
    elementId: `corpus-deck-text-${index}`, expectedText: String(expectedText), direction: recipeId === "deck-rtl" ? "rtl" as const : "ltr" as const,
    startSeconds: index * DURATION_SECONDS / (recipeId === "deck-cut" ? 2 : 1),
    endSeconds: (index + 1) * DURATION_SECONDS / (recipeId === "deck-cut" ? 2 : 1),
  }));
  const css = `.corpus-deck{position:relative;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;}
    .corpus-deck-fill{position:absolute;inset:0;background:#101820;}
    .corpus-deck-text{position:absolute;left:120px;top:180px;width:${recipeId === "deck-wrap" ? 440 : 1400}px;
    margin:0;font-family:Arial,sans-serif;font-size:48px;line-height:1.25;color:#fff;white-space:normal;}`;
  const document = createInitialCompositionDocument({sourceInsertionMode: "AUTOMATIC", assets: [],
    plan: {title: "CAP-027 deck corpus", subtitle: recipeId, accentColor: "#38BDF8", durationSeconds: DURATION_SECONDS},
    animatedDeck: {width: WIDTH, height: HEIGHT, css, fonts: [], slides: expectations.map((expected, index) => ({
      index, label: `Deck ${index}`, animationCount: 0, classes: "slide corpus-deck",
      html: `<div class="corpus-deck-fill"></div><p id="${expected.elementId}" class="corpus-deck-text" dir="${expected.direction}">${expected.expectedText}</p>`,
    }))},
  });
  document.canvas.fps = fps;
  document.canvas.durationSeconds = DURATION_SECONDS;
  document.clips.forEach((clip, index) => {
    clip.startSeconds = expectations[index]!.startSeconds;
    clip.durationSeconds = expectations[index]!.endSeconds - clip.startSeconds;
    clip.timingSource = "USER_EDITED";
    if (recipeId === "deck-transform") {clip.layout.rotation = 17; clip.layout.opacity = 0.6;}
  });
  const validated = compositionEditorDocumentSchema.parse(document);
  const documentHash = hashCompositionDocument(validated);
  const sourceTextPlan = buildDeckTextPlan(validated);
  const expectationLedger = {scope: "AUTHORED_DECK_TEXT_EXPECTATIONS_NOT_CAPTURE_EVIDENCE" as const,
    documentHash, entries: expectations.map((expected, index) => ({...expected, clipId: validated.clips[index]!.id}))};
  const identity = {corpusVersion: DECK_CONFORMANCE_CORPUS_VERSION, recipeId, fps, documentHash,
    expectationLedgerSha256: digest(JSON.stringify(expectationLedger)), sourceTextPlanSha256: hashDeckTextPlan(sourceTextPlan)};
  return {...identity, caseSha256: digest(JSON.stringify(identity)), document: validated, expectationLedger, sourceTextPlan,
    scope: "DETERMINISTIC_DECK_DOCUMENT_RECIPE_NOT_RENDER_EVIDENCE" as const};
}

export const DECK_CORPUS_REMAINING_REQUIREMENTS = [
  "DECK_TEXT_CAPTURE_AND_STRICT_MASKS", "EFFECTIVE_FONT_PROVENANCE", "BROWSER_AND_RENDER_MEASUREMENTS",
] as const;

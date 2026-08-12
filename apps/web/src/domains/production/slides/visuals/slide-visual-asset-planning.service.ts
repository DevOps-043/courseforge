import { createHash } from "node:crypto";
import type {
  CourseDeckSpec,
  CourseSlideSpec,
  CourseVisualAsset,
  CourseVisualAssetPurpose,
  CourseVisualAssetSlot,
} from "../specs/course-deck.schema";

const MAX_BACKGROUND_ASSETS_PER_DECK = 3;
const MAX_SUPPORTING_ASSETS_PER_DECK = 4;

const GENERIC_SLOTS: Record<string, CourseVisualAssetSlot[]> = {
  center: [{
    id: "atmospheric_background",
    opacity: 0.14,
    placement: "background",
    purpose: "background",
  }],
  closing: [{
    id: "atmospheric_background",
    opacity: 0.16,
    placement: "background",
    purpose: "background",
  }],
  split: [{
    id: "supporting_visual",
    placement: "image_pane",
    purpose: "supporting",
  }],
  split_reverse: [{
    id: "supporting_visual",
    placement: "image_pane",
    purpose: "supporting",
  }],
};

function compactText(value: string | undefined) {
  return value?.trim().replace(/\s+/g, " ") || "";
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function promptHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function assetId(slideId: string, purpose: CourseVisualAssetPurpose, prompt: string) {
  return `${slideId}-${purpose}-${promptHash(prompt).slice(0, 16)}`;
}

function slotsForSlide(deck: CourseDeckSpec, slide: CourseSlideSpec) {
  const layout = slide.renderHints?.layout;
  if (!layout) return [];
  return deck.designSystem.visualSlots?.[layout] || GENERIC_SLOTS[layout] || [];
}

function slotForPurpose(
  deck: CourseDeckSpec,
  slide: CourseSlideSpec,
  purpose: CourseVisualAssetPurpose,
) {
  return slotsForSlide(deck, slide).find((slot) => slot.purpose === purpose);
}

function slideBodyText(slide: CourseSlideSpec) {
  return slide.bodyBlocks.map((block) => {
    if (block.kind === "bullets") return (block.items || []).join("; ");
    return block.text || "";
  }).join(" ");
}

function externalSourceRefs(slide: CourseSlideSpec) {
  return slide.validationHints.sourceRefs.filter((sourceRef) => !sourceRef.startsWith("component."));
}

function isBackgroundCandidate(slide: CourseSlideSpec) {
  return slide.type === "cover" || slide.type === "summary" ||
    slide.renderHints?.layout === "center" || slide.renderHints?.layout === "closing";
}

function isSupportingCandidate(slide: CourseSlideSpec) {
  if (slide.chart || slide.type === "data_explainer") return false;
  if (externalSourceRefs(slide).length === 0) return false;
  if (!["concept", "explanation", "worked_example", "exercise"].includes(slide.type)) return false;
  return slide.renderHints?.layout === "split" || slide.renderHints?.layout === "split_reverse";
}

function hasReadyAsset(asset: CourseVisualAsset | null | undefined) {
  return asset?.status === "READY" && Boolean(asset.url);
}

function visualAssetsForSlide(slide: CourseSlideSpec) {
  return slide.visualAssets || { background: null, supporting: null };
}

function buildBackgroundAsset(deck: CourseDeckSpec, slide: CourseSlideSpec, slot: CourseVisualAssetSlot): CourseVisualAsset {
  const styleGuide = compactText(deck.designSystem.visualStyleGuide) ||
    "Editorial educational visual, refined abstract forms, restrained palette and calm contrast.";
  const theme = truncate(compactText(deck.sourceSnapshot.title) || slide.title, 180);
  const prompt = [
    "Create a subtle atmospheric background for a 16:9 educational presentation slide.",
    `Deck theme: ${theme}.`,
    `Visual style: ${styleGuide}.`,
    "Keep the image secondary to foreground text, low in visual density, and leave generous negative space.",
    "No text, numbers, logos, watermarks, UI, charts, diagrams, or prominent faces.",
  ].join(" ");

  return {
    altText: `Fondo decorativo para ${truncate(slide.title, 120)}`,
    id: assetId(slide.id, "background", prompt),
    prompt,
    promptHash: promptHash(prompt),
    purpose: "background",
    reason: "El layout permite un fondo decorativo que refuerza la identidad del deck sin añadir contenido educativo.",
    slot,
    sourceRefs: [],
    status: "PLANNED",
  };
}

function buildSupportingAsset(deck: CourseDeckSpec, slide: CourseSlideSpec, slot: CourseVisualAssetSlot): CourseVisualAsset {
  const styleGuide = compactText(deck.designSystem.visualStyleGuide) ||
    "Editorial educational visual, polished and realistic, with a restrained corporate palette.";
  const educationalContext = truncate([
    slide.title,
    slide.subtitle || "",
    slideBodyText(slide),
  ].filter(Boolean).join(". "), 900);
  const prompt = [
    "Create one educational supporting image for a presentation slide.",
    `Educational context: ${educationalContext}.`,
    `Visual style: ${styleGuide}.`,
    "Show a clear visual metaphor or scenario that improves comprehension of the supplied context.",
    "The image will occupy a side panel; keep the main subject centered and leave some negative space.",
    "No text, labels, numbers, logos, watermarks, UI screenshots, charts, infographics, or unsupported factual claims.",
  ].join(" ");

  return {
    altText: `Ilustración de apoyo: ${truncate(slide.title, 160)}`,
    id: assetId(slide.id, "supporting", prompt),
    prompt,
    promptHash: promptHash(prompt),
    purpose: "supporting",
    reason: "La diapositiva se llena desde fuentes y dispone de un panel visual para reforzar su explicación.",
    slot,
    sourceRefs: externalSourceRefs(slide),
    status: "PLANNED",
  };
}

function planBackgrounds(deck: CourseDeckSpec, forceRegenerate: boolean) {
  let plannedCount = 0;
  return deck.slides.map((slide) => {
    if (!forceRegenerate && hasReadyAsset(visualAssetsForSlide(slide).background)) return slide;
    const slot = slotForPurpose(deck, slide, "background");
    if (!slot || !isBackgroundCandidate(slide) || plannedCount >= MAX_BACKGROUND_ASSETS_PER_DECK) {
      return slide;
    }
    plannedCount += 1;
    return {
      ...slide,
      visualAssets: {
        ...visualAssetsForSlide(slide),
        background: buildBackgroundAsset(deck, slide, slot),
      },
    };
  });
}

function planSupportingVisuals(deck: CourseDeckSpec, forceRegenerate: boolean) {
  let plannedCount = 0;
  return deck.slides.map((slide) => {
    if (!forceRegenerate && hasReadyAsset(visualAssetsForSlide(slide).supporting)) return slide;
    const slot = slotForPurpose(deck, slide, "supporting");
    if (!slot || !isSupportingCandidate(slide) || plannedCount >= MAX_SUPPORTING_ASSETS_PER_DECK) {
      return slide;
    }
    plannedCount += 1;
    return {
      ...slide,
      visualAssets: {
        ...visualAssetsForSlide(slide),
        supporting: buildSupportingAsset(deck, slide, slot),
      },
    };
  });
}

/**
 * Backgrounds intentionally use only deck/template data. Supporting visuals use
 * source-backed slide content and must run only after the visible copy is ready.
 */
export function planDeckVisualAssets(params: {
  deckSpec: CourseDeckSpec;
  forceRegenerate?: boolean;
}): CourseDeckSpec {
  const forceRegenerate = Boolean(params.forceRegenerate);
  const withBackgrounds = {
    ...params.deckSpec,
    slides: planBackgrounds(params.deckSpec, forceRegenerate),
  };

  return {
    ...withBackgrounds,
    slides: planSupportingVisuals(withBackgrounds, forceRegenerate),
  };
}

export function visualAssetPlanSummary(deckSpec: CourseDeckSpec) {
  const assets = deckSpec.slides.flatMap((slide) => [
    visualAssetsForSlide(slide).background,
    visualAssetsForSlide(slide).supporting,
  ]).filter((asset): asset is CourseVisualAsset => Boolean(asset));

  return {
    backgroundCount: assets.filter((asset) => asset.purpose === "background").length,
    plannedCount: assets.filter((asset) => asset.status === "PLANNED").length,
    readyCount: assets.filter((asset) => asset.status === "READY").length,
    supportingCount: assets.filter((asset) => asset.purpose === "supporting").length,
  };
}

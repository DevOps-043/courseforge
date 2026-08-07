import type { EditableLayerDefinition } from "@/remotion/layout-overrides";
import type { BundleAgentSpec } from "./types";
import {
  buildBundleDesignPlan,
  createBundleVisualFingerprint,
  type BundleVisualFingerprint,
} from "./design-plan.service";
import type { BundleAgentDesignPlan } from "./types";

export type BundleBlueprintLayout =
  | "avatar-left-slides-broll-right"
  | "cinematic-field"
  | "editorial-rail"
  | "floating-collage"
  | "minimal-focus"
  | "reference-frame-avatar-left-stack-right"
  | "split-contrast"
  | "support-left-avatar-right"
  | "split-avatar-support"
  | "stacked-support"
  | "media-only";

export type BundleBlueprintTimeline = "equal-slides-with-indexed-broll" | "equal-support-visuals";

export interface LayerBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BundleBlueprint {
  title: string;
  description: string;
  compositionId: string;
  fps: number;
  width: number;
  height: number;
  fallbackDurationFrames: number;
  requiredAssets: BundleAgentSpec["requiredAssets"];
  defaultVisualVariantId: string;
  defaultAnimationVariant: string;
  layout: BundleBlueprintLayout;
  timeline: BundleBlueprintTimeline;
  designPlan: BundleAgentDesignPlan;
  visualFingerprint: BundleVisualFingerprint;
  renderText: boolean;
  accentColor: string;
  boxes: {
    avatar: LayerBox;
    primaryVisual: LayerBox;
    slides: LayerBox;
    broll: LayerBox;
  };
  editableLayers: EditableLayerDefinition[];
  changeSummary: string;
}

const CAN_EDIT_MEDIA_LAYER = {
  canMove: true,
  canResize: true,
  canCrop: true,
  canRotate: false,
  canHide: true,
  canReorder: true,
};

const CAN_EDIT_CONTAINER_LAYER = {
  canMove: true,
  canResize: true,
  canCrop: false,
  canRotate: false,
  canHide: false,
  canReorder: false,
};

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function getIntentText(spec: BundleAgentSpec) {
  const creativeBrief = spec.creativeBrief;
  return [
    spec.title,
    spec.description,
    spec.visualStyle,
    spec.changeSummary,
    creativeBrief?.directionName,
    creativeBrief?.layoutSystem,
    creativeBrief?.motionLanguage,
    creativeBrief?.visualVariants?.map((variant) => `${variant.name} ${variant.composition} ${variant.motion}`).join(" "),
  ].filter(Boolean).join(" ").toLowerCase();
}

function shouldRenderText(spec: BundleAgentSpec) {
  const intent = getIntentText(spec);
  const forbidsText = includesAny(intent, [
    "no quiero que pongas nada de letras",
    "sin letras",
    "sin texto",
    "no texto",
    "no renderizar texto",
    "no subtitulos",
    "sin subtitulos",
    "sin captions",
  ]);

  if (forbidsText) return false;
  return spec.requiredAssets.includes("captions");
}

function resolveLayout(spec: BundleAgentSpec, designPlan: BundleAgentDesignPlan): BundleBlueprintLayout {
  const intent = getIntentText(spec);
  const hasAvatar = spec.requiredAssets.includes("avatar");
  const hasSlides = spec.requiredAssets.includes("slides");
  const hasBroll = spec.requiredAssets.includes("broll");
  const asksLeftAvatar = includesAny(intent, ["avatar totalmente a la izquierda", "avatar fijo izquierda", "avatar a la izquierda"]);
  const asksRightAvatar = includesAny(intent, ["avatar a la derecha", "avatar del lado derecho", "avatar fijo derecha"]);
  const asksRightStack = includesAny(intent, ["superior derecha", "inferior derecha", "lado derecho", "diapositiva arriba", "b-roll abajo"]);
  const asksStacked = includesAny(intent, ["vertical", "apilado", "arriba y abajo", "slide arriba", "b-roll abajo", "diapositiva arriba"]);
  const asksExplicitStackedLayout = includesAny(intent, ["vertical", "apilado", "arriba y abajo", "stacked studio", "stacked support", "stacked evidence"]);
  const asksFullscreen = includesAny(intent, ["pantalla completa", "full screen", "fullscreen", "visual principal a pantalla completa", "media field", "media-led"]);
  const asksReferenceWireframe = includesAny(intent, [
    "reference wireframe lock",
    "wireframe de referencia",
    "large left region plus right column split",
    "left half reserved for avatar",
    "slide region above and b-roll region below",
  ]);

  if (designPlan.templateFamily === "reference-frame" || (hasAvatar && hasSlides && hasBroll && asksReferenceWireframe)) {
    return "reference-frame-avatar-left-stack-right";
  }

  if (designPlan.source === "explicit-family") {
    if (designPlan.templateFamily === "cinematic-field") {
      return "cinematic-field";
    }

    if (designPlan.templateFamily === "editorial-rail") {
      return "editorial-rail";
    }

    if (designPlan.templateFamily === "floating-collage") {
      return "floating-collage";
    }

    if (designPlan.templateFamily === "minimal-focus") {
      return "minimal-focus";
    }

    if (designPlan.templateFamily === "stacked-evidence") {
      return "stacked-support";
    }

    if (designPlan.templateFamily === "split-contrast" && !(hasAvatar && asksRightAvatar)) {
      return "split-contrast";
    }
  }

  if (asksFullscreen && (hasSlides || hasBroll) && !hasAvatar) {
    return "media-only";
  }

  if (hasAvatar && (hasSlides || hasBroll) && asksRightAvatar) {
    return "support-left-avatar-right";
  }

  if (hasAvatar && hasSlides && hasBroll && asksStacked && asksExplicitStackedLayout && !asksLeftAvatar) {
    return "stacked-support";
  }

  if (hasAvatar && hasSlides && hasBroll && (asksLeftAvatar || asksRightStack || !shouldRenderText(spec))) {
    return "avatar-left-slides-broll-right";
  }

  if (hasAvatar && (hasSlides || hasBroll)) {
    return "split-avatar-support";
  }

  if (designPlan.templateFamily === "cinematic-field") {
    return "cinematic-field";
  }

  if (designPlan.templateFamily === "editorial-rail") {
    return "editorial-rail";
  }

  if (designPlan.templateFamily === "floating-collage") {
    return "floating-collage";
  }

  if (designPlan.templateFamily === "minimal-focus") {
    return "minimal-focus";
  }

  if (designPlan.templateFamily === "stacked-evidence") {
    return "stacked-support";
  }

  if (designPlan.templateFamily === "split-contrast") {
    return "split-contrast";
  }

  return "media-only";
}

function resolveTimeline(spec: BundleAgentSpec, layout: BundleBlueprintLayout, designPlan: BundleAgentDesignPlan): BundleBlueprintTimeline {
  const intent = getIntentText(spec);
  const asksEqualSlides = includesAny(intent, [
    "mismo tiempo",
    "todas las diapositivas",
    "total de diapositivas",
    "se vean todas las diapositivas",
  ]);

  if (
    layout === "avatar-left-slides-broll-right"
    || layout === "reference-frame-avatar-left-stack-right"
    || designPlan.sceneStrategy === "dual-support"
    || asksEqualSlides
  ) {
    return "equal-slides-with-indexed-broll";
  }

  return "equal-support-visuals";
}

function box(x: number, y: number, width: number, height: number): LayerBox {
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function buildBoxes(layout: BundleBlueprintLayout, width: number, height: number) {
  if (layout === "cinematic-field") {
    const margin = Math.round(Math.min(width, height) * 0.05);
    const overlayWidth = Math.round(width * 0.34);
    const overlayHeight = Math.round(height * 0.28);
    return {
      avatar: box(width - overlayWidth - margin, height - overlayHeight - margin, overlayWidth, overlayHeight),
      primaryVisual: box(0, 0, width, height),
      slides: box(margin, margin, Math.round(width * 0.58), Math.round(height * 0.64)),
      broll: box(width - overlayWidth - margin, margin, overlayWidth, overlayHeight),
    };
  }

  if (layout === "editorial-rail") {
    const margin = Math.round(Math.min(width, height) * 0.045);
    const railWidth = Math.round(width * 0.27);
    const contentX = railWidth + margin * 2;
    const contentWidth = width - contentX - margin;
    const brollHeight = Math.round(height * 0.26);
    return {
      avatar: box(margin, margin, railWidth - margin, height - margin * 2),
      primaryVisual: box(contentX, 0, width - contentX, height),
      slides: box(contentX + margin, margin, contentWidth - margin * 2, height - brollHeight - margin * 3),
      broll: box(contentX + margin, height - brollHeight - margin, contentWidth - margin * 2, brollHeight),
    };
  }

  if (layout === "floating-collage") {
    const margin = Math.round(Math.min(width, height) * 0.045);
    return {
      avatar: box(margin, Math.round(height * 0.18), Math.round(width * 0.31), Math.round(height * 0.66)),
      primaryVisual: box(0, 0, width, height),
      slides: box(Math.round(width * 0.35), margin, Math.round(width * 0.54), Math.round(height * 0.56)),
      broll: box(Math.round(width * 0.57), Math.round(height * 0.57), Math.round(width * 0.36), Math.round(height * 0.34)),
    };
  }

  if (layout === "minimal-focus") {
    const margin = Math.round(Math.min(width, height) * 0.075);
    const supportWidth = width - margin * 2;
    const supportHeight = height - margin * 2;
    return {
      avatar: box(width - Math.round(width * 0.26) - margin, height - Math.round(height * 0.25) - margin, Math.round(width * 0.26), Math.round(height * 0.25)),
      primaryVisual: box(0, 0, width, height),
      slides: box(margin, margin, supportWidth, supportHeight),
      broll: box(margin, margin, supportWidth, supportHeight),
    };
  }

  if (layout === "avatar-left-slides-broll-right") {
    const avatarWidth = width * 0.42;
    const rightX = avatarWidth;
    const rightWidth = width - avatarWidth;
    const margin = 36;
    const brollWidth = Math.round(width * 0.271);
    const brollHeight = Math.round(brollWidth * (9 / 16));

    return {
      avatar: box(0, 0, avatarWidth, height),
      primaryVisual: box(rightX, 0, rightWidth, height),
      slides: box(rightX + margin, margin, rightWidth - margin * 2, height - brollHeight - margin * 4),
      broll: box(width - brollWidth - margin, height - brollHeight - margin, brollWidth, brollHeight),
    };
  }

  if (layout === "reference-frame-avatar-left-stack-right") {
    const frame = Math.round(Math.min(width, height) * 0.032);
    const gap = Math.max(4, Math.round(Math.min(width, height) * 0.004));
    const innerX = frame;
    const innerY = frame;
    const innerWidth = width - frame * 2;
    const innerHeight = height - frame * 2;
    const leftWidth = Math.round((innerWidth - gap) * 0.5);
    const rightX = innerX + leftWidth + gap;
    const rightWidth = innerWidth - leftWidth - gap;
    const supportHeight = Math.round((innerHeight - gap) * 0.5);

    return {
      avatar: box(innerX, innerY, leftWidth, innerHeight),
      primaryVisual: box(0, 0, width, height),
      slides: box(rightX, innerY, rightWidth, supportHeight),
      broll: box(rightX, innerY + supportHeight + gap, rightWidth, innerHeight - supportHeight - gap),
    };
  }

  if (layout === "split-contrast") {
    const margin = Math.round(Math.min(width, height) * 0.04);
    const avatarWidth = Math.round(width * 0.46);
    const supportWidth = width - avatarWidth - margin * 3;
    const supportHeight = Math.round((height - margin * 3) / 2);
    return {
      avatar: box(width - avatarWidth - margin, margin, avatarWidth, height - margin * 2),
      primaryVisual: box(0, 0, width - avatarWidth, height),
      slides: box(margin, margin, supportWidth, supportHeight),
      broll: box(margin, margin * 2 + supportHeight, supportWidth, height - supportHeight - margin * 3),
    };
  }

  if (layout === "split-avatar-support") {
    const half = width / 2;
    return {
      avatar: box(0, 0, half, height),
      primaryVisual: box(half, 0, half, height),
      slides: box(half + 48, 48, half - 96, height - 96),
      broll: box(width - 560 - 48, height - 315 - 48, 560, 315),
    };
  }

  if (layout === "support-left-avatar-right") {
    const avatarWidth = width * 0.38;
    const supportWidth = width - avatarWidth;
    const margin = 48;
    return {
      avatar: box(supportWidth, 0, avatarWidth, height),
      primaryVisual: box(0, 0, supportWidth, height),
      slides: box(margin, margin, supportWidth - margin * 2, height - margin * 2),
      broll: box(margin, height - 360 - margin, 640, 360),
    };
  }

  if (layout === "stacked-support") {
    const avatarWidth = width * 0.36;
    const supportWidth = width - avatarWidth;
    const margin = 42;
    const supportX = avatarWidth;
    const supportHeight = (height - margin * 3) / 2;
    return {
      avatar: box(0, 0, avatarWidth, height),
      primaryVisual: box(supportX, 0, supportWidth, height),
      slides: box(supportX + margin, margin, supportWidth - margin * 2, supportHeight),
      broll: box(supportX + margin, margin * 2 + supportHeight, supportWidth - margin * 2, supportHeight),
    };
  }

  return {
    avatar: box(48, height - 360 - 48, 640, 360),
    primaryVisual: box(0, 0, width, height),
    slides: box(48, 48, width - 96, height - 96),
    broll: box(width - 640 - 48, height - 360 - 48, 640, 360),
  };
}

function buildEditableLayers(boxes: BundleBlueprint["boxes"]): EditableLayerDefinition[] {
  return [
    {
      layerId: "avatar",
      label: "Avatar",
      kind: "avatar",
      defaultBox: boxes.avatar,
      defaultStackOrder: 10,
      stackGroup: "root",
      itemLayerIdPattern: "avatar:{order}",
      capabilities: CAN_EDIT_MEDIA_LAYER,
      constraints: { minWidth: 320, minHeight: 240, safeArea: "full" },
    },
    {
      layerId: "primaryVisual",
      label: "Contenedor visual",
      kind: "custom",
      defaultBox: boxes.primaryVisual,
      defaultStackOrder: 0,
      stackGroup: "root",
      capabilities: CAN_EDIT_CONTAINER_LAYER,
      constraints: { minWidth: 480, minHeight: 360, safeArea: "full" },
    },
    {
      layerId: "slides",
      label: "Diapositivas",
      kind: "slides",
      defaultBox: boxes.slides,
      defaultStackOrder: 20,
      stackGroup: "root",
      itemLayerIdPattern: "slide:{index}",
      capabilities: CAN_EDIT_MEDIA_LAYER,
      constraints: { minWidth: 360, minHeight: 220, safeArea: "full" },
    },
    {
      layerId: "broll",
      label: "B-roll",
      kind: "broll",
      defaultBox: boxes.broll,
      defaultStackOrder: 30,
      stackGroup: "root",
      itemLayerIdPattern: "broll:{order}",
      capabilities: CAN_EDIT_MEDIA_LAYER,
      constraints: { minWidth: 240, minHeight: 135, lockAspectRatio: true, safeArea: "full" },
    },
  ];
}

function getAccentColor(spec: BundleAgentSpec) {
  const value = spec.defaultProps.accentColor || spec.creativeBrief?.colorTokens?.accent;
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : "#00D4B3";
}

export function buildBundleBlueprint(spec: BundleAgentSpec): BundleBlueprint {
  const width = Number.isFinite(spec.width) ? spec.width : 1920;
  const height = Number.isFinite(spec.height) ? spec.height : 1080;
  const designPlan = buildBundleDesignPlan(spec);
  const layout = resolveLayout(spec, designPlan);
  const timeline = resolveTimeline(spec, layout, designPlan);
  const boxes = buildBoxes(layout, width, height);

  return {
    title: spec.title,
    description: spec.description,
    compositionId: spec.compositionId,
    fps: Number.isFinite(spec.fps) ? spec.fps : 30,
    width,
    height,
    fallbackDurationFrames: Number.isFinite(spec.durationFrames) ? spec.durationFrames : 150,
    requiredAssets: spec.requiredAssets,
    defaultVisualVariantId: typeof spec.defaultProps.visualVariantId === "string"
      ? spec.defaultProps.visualVariantId
      : spec.creativeBrief.visualVariants[0]?.id || "variant-studio-asymmetric",
    defaultAnimationVariant: typeof spec.defaultProps.animationVariant === "string"
      ? spec.defaultProps.animationVariant
      : designPlan.transition,
    layout,
    timeline,
    designPlan,
    visualFingerprint: createBundleVisualFingerprint(spec, designPlan),
    renderText: shouldRenderText(spec),
    accentColor: getAccentColor(spec),
    boxes,
    editableLayers: buildEditableLayers(boxes),
    changeSummary: spec.changeSummary,
  };
}

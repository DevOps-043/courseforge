import type { EditableLayerDefinition } from "@/remotion/layout-overrides";
import type { BundleAgentSpec } from "./types";

export type BundleBlueprintLayout =
  | "avatar-left-slides-broll-right"
  | "split-avatar-support"
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
  layout: BundleBlueprintLayout;
  timeline: BundleBlueprintTimeline;
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
};

const CAN_EDIT_CONTAINER_LAYER = {
  canMove: true,
  canResize: true,
  canCrop: false,
  canRotate: false,
  canHide: false,
};

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function getIntentText(spec: BundleAgentSpec) {
  return `${spec.title} ${spec.description} ${spec.visualStyle} ${spec.changeSummary}`.toLowerCase();
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

function resolveLayout(spec: BundleAgentSpec): BundleBlueprintLayout {
  const intent = getIntentText(spec);
  const hasAvatar = spec.requiredAssets.includes("avatar");
  const hasSlides = spec.requiredAssets.includes("slides");
  const hasBroll = spec.requiredAssets.includes("broll");
  const asksLeftAvatar = includesAny(intent, ["avatar totalmente a la izquierda", "avatar fijo izquierda", "avatar a la izquierda"]);
  const asksRightStack = includesAny(intent, ["superior derecha", "inferior derecha", "lado derecho", "diapositiva arriba", "b-roll abajo"]);

  if (hasAvatar && hasSlides && hasBroll && (asksLeftAvatar || asksRightStack || !shouldRenderText(spec))) {
    return "avatar-left-slides-broll-right";
  }

  if (hasAvatar && (hasSlides || hasBroll)) {
    return "split-avatar-support";
  }

  return "media-only";
}

function resolveTimeline(spec: BundleAgentSpec, layout: BundleBlueprintLayout): BundleBlueprintTimeline {
  const intent = getIntentText(spec);
  const asksEqualSlides = includesAny(intent, [
    "mismo tiempo",
    "todas las diapositivas",
    "total de diapositivas",
    "se vean todas las diapositivas",
  ]);

  if (layout === "avatar-left-slides-broll-right" || asksEqualSlides) {
    return "equal-slides-with-indexed-broll";
  }

  return "equal-support-visuals";
}

function box(x: number, y: number, width: number, height: number): LayerBox {
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function buildBoxes(layout: BundleBlueprintLayout, width: number, height: number) {
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

  if (layout === "split-avatar-support") {
    const half = width / 2;
    return {
      avatar: box(0, 0, half, height),
      primaryVisual: box(half, 0, half, height),
      slides: box(half + 48, 48, half - 96, height - 96),
      broll: box(width - 560 - 48, height - 315 - 48, 560, 315),
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
      capabilities: CAN_EDIT_MEDIA_LAYER,
      constraints: { minWidth: 320, minHeight: 240, safeArea: "full" },
    },
    {
      layerId: "primaryVisual",
      label: "Contenedor visual",
      kind: "custom",
      defaultBox: boxes.primaryVisual,
      capabilities: CAN_EDIT_CONTAINER_LAYER,
      constraints: { minWidth: 480, minHeight: 360, safeArea: "full" },
    },
    {
      layerId: "slides",
      label: "Diapositivas",
      kind: "slides",
      defaultBox: boxes.slides,
      capabilities: CAN_EDIT_MEDIA_LAYER,
      constraints: { minWidth: 360, minHeight: 220, safeArea: "full" },
    },
    {
      layerId: "broll",
      label: "B-roll",
      kind: "broll",
      defaultBox: boxes.broll,
      capabilities: CAN_EDIT_MEDIA_LAYER,
      constraints: { minWidth: 240, minHeight: 135, lockAspectRatio: true, safeArea: "full" },
    },
  ];
}

function getAccentColor(spec: BundleAgentSpec) {
  const value = spec.defaultProps.accentColor;
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : "#00D4B3";
}

export function buildBundleBlueprint(spec: BundleAgentSpec): BundleBlueprint {
  const width = Number.isFinite(spec.width) ? spec.width : 1920;
  const height = Number.isFinite(spec.height) ? spec.height : 1080;
  const layout = resolveLayout(spec);
  const timeline = resolveTimeline(spec, layout);
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
    layout,
    timeline,
    renderText: shouldRenderText(spec),
    accentColor: getAccentColor(spec),
    boxes,
    editableLayers: buildEditableLayers(boxes),
    changeSummary: spec.changeSummary,
  };
}

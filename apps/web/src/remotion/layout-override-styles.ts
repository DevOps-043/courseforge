import type {
  LayoutOverrideEdit,
  LayoutOverrideManifestList,
} from "./layout-overrides";

export type LayoutOverrideStyle = {
  position?: "absolute";
  left?: number;
  top?: number;
  right?: number | "auto";
  bottom?: number | "auto";
  width?: number;
  height?: number;
  flex?: "none";
  clipPath?: string;
  transform?: string;
  display?: "none";
  zIndex?: number;
};

const MIN_VISIBLE_CROP_AREA_RATIO = 0.1;

export const REMOTION_EDITABLE_LAYERS = {
  AVATAR: "avatar",
  PRIMARY_VISUAL: "primaryVisual",
  SUPPORT_STRIP: "supportStrip",
  SLIDES: "slides",
  BROLL: "broll",
  CAPTION: "caption",
  BACKGROUND: "background",
} as const;

export type RemotionEditableLayerId = string;

const SLIDE_ITEM_LAYER_PREFIX = "slide:";
const BROLL_ITEM_LAYER_PREFIX = "broll:";

export function getSlideItemLayerId(index: number): RemotionEditableLayerId {
  return `${SLIDE_ITEM_LAYER_PREFIX}${Math.max(0, Math.round(index))}`;
}

export function getBrollItemLayerId(order: number): RemotionEditableLayerId {
  return `${BROLL_ITEM_LAYER_PREFIX}${Math.max(1, Math.round(order))}`;
}

export function isSlideItemLayerId(layerId: string): boolean {
  return layerId.startsWith(SLIDE_ITEM_LAYER_PREFIX);
}

export function isBrollItemLayerId(layerId: string): boolean {
  return layerId.startsWith(BROLL_ITEM_LAYER_PREFIX);
}

function getLayerEdits(
  manifests: LayoutOverrideManifestList | null | undefined,
  layerId: string,
): LayoutOverrideEdit[] {
  if (!Array.isArray(manifests)) {
    return [];
  }

  return manifests.flatMap((manifest) =>
    manifest.edits.filter((edit) => edit.layerId === layerId),
  );
}

function formatCropInset(value: number): string {
  return `${Math.round(value * 10000) / 100}%`;
}

function clampCropInset(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(0.95, Math.max(0, value));
}

function normalizeCropForStyle(crop: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}) {
  const top = clampCropInset(crop.top);
  const right = clampCropInset(crop.right);
  const bottom = clampCropInset(crop.bottom);
  const left = clampCropInset(crop.left);
  const visibleWidth = Math.max(0, 1 - left - right);
  const visibleHeight = Math.max(0, 1 - top - bottom);

  if (visibleWidth * visibleHeight < MIN_VISIBLE_CROP_AREA_RATIO) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  return { top, right, bottom, left };
}

export function buildLayoutOverrideStyle(
  manifests: LayoutOverrideManifestList | null | undefined,
  layerId: string,
): LayoutOverrideStyle {
  const edits = getLayerEdits(manifests, layerId);
  if (edits.length === 0) {
    return {};
  }

  const style: LayoutOverrideStyle = {};

  for (const edit of edits) {
    if (edit.kind === "position") {
      style.position = "absolute";
      style.left = edit.x;
      style.top = edit.y;
      style.right = "auto";
      style.bottom = "auto";
      style.flex = "none";
    }

    if (edit.kind === "size") {
      style.width = edit.width;
      style.height = edit.height;
      style.flex = "none";
    }

    if (edit.kind === "crop") {
      const crop = normalizeCropForStyle(edit);
      style.clipPath = `inset(${formatCropInset(crop.top)} ${formatCropInset(
        crop.right,
      )} ${formatCropInset(crop.bottom)} ${formatCropInset(crop.left)})`;
    }

    if (edit.kind === "rotation") {
      style.transform = `rotate(${edit.angle}deg)`;
    }

    if (edit.kind === "visibility" && edit.hidden) {
      style.display = "none";
    }

    if (edit.kind === "stack") {
      style.zIndex = edit.order;
    }
  }

  return style;
}

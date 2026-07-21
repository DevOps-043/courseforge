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
};

export const REMOTION_EDITABLE_LAYERS = {
  AVATAR: "avatar",
  PRIMARY_VISUAL: "primaryVisual",
  SUPPORT_STRIP: "supportStrip",
  SLIDES: "slides",
  BROLL: "broll",
  CAPTION: "caption",
  BACKGROUND: "background",
} as const;

export type RemotionEditableLayerId =
  (typeof REMOTION_EDITABLE_LAYERS)[keyof typeof REMOTION_EDITABLE_LAYERS];

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
      style.clipPath = `inset(${formatCropInset(edit.top)} ${formatCropInset(
        edit.right,
      )} ${formatCropInset(edit.bottom)} ${formatCropInset(edit.left)})`;
    }

    if (edit.kind === "rotation") {
      style.transform = `rotate(${edit.angle}deg)`;
    }

    if (edit.kind === "visibility" && edit.hidden) {
      style.display = "none";
    }
  }

  return style;
}

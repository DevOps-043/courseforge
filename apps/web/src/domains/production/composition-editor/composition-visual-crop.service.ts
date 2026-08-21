import type { CompositionClip, CompositionVisualCrop } from "./composition-document.types";

type CompositionLayout = CompositionClip["layout"];

export type CompositionCropInsets = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export function isCompositionCropInsets(crop: CompositionVisualCrop): crop is CompositionCropInsets {
  return "top" in crop;
}

export function resolveCompositionCropInsets(
  crop: CompositionVisualCrop | undefined,
  layout: Pick<CompositionLayout, "height" | "width">,
): CompositionCropInsets {
  if (!crop) return { bottom: 0, left: 0, right: 0, top: 0 };
  if (isCompositionCropInsets(crop)) return normalizeCompositionCropInsets(crop, layout);

  const visibleWidth = layout.width / crop.zoom;
  const visibleHeight = layout.height / crop.zoom;
  return normalizeCompositionCropInsets({
    bottom: layout.height * (1 - crop.focusY) - visibleHeight / 2,
    left: layout.width * crop.focusX - visibleWidth / 2,
    right: layout.width * (1 - crop.focusX) - visibleWidth / 2,
    top: layout.height * crop.focusY - visibleHeight / 2,
  }, layout);
}

export function normalizeCompositionCropInsets(
  crop: CompositionCropInsets,
  layout: Pick<CompositionLayout, "height" | "width">,
): CompositionCropInsets {
  const minimumVisiblePixels = 1;
  const left = clamp(crop.left, 0, Math.max(0, layout.width - minimumVisiblePixels));
  const right = clamp(crop.right, 0, Math.max(0, layout.width - left - minimumVisiblePixels));
  const top = clamp(crop.top, 0, Math.max(0, layout.height - minimumVisiblePixels));
  const bottom = clamp(crop.bottom, 0, Math.max(0, layout.height - top - minimumVisiblePixels));
  return { bottom, left, right, top };
}

export function hasCompositionCrop(crop: CompositionCropInsets) {
  return crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

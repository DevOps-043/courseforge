export type CanvasGuideLayout = { x: number; y: number; width: number; height: number; rotation: number };
export type CanvasGuideCrop = { left: number; right: number; top: number; bottom: number };

/** Editorial cropped rectangle rotated around the layout center; excludes inner motion transforms. */
export function compositionCanvasVisibleBounds(layout: CanvasGuideLayout, crop: CanvasGuideCrop) {
  if (![...Object.values(layout), ...Object.values(crop)].every(Number.isFinite)
    || layout.width <= 0 || layout.height <= 0 || Object.values(crop).some((value) => value < 0)
    || crop.left + crop.right >= layout.width || crop.top + crop.bottom >= layout.height) return null;
  const radians = layout.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localCenterX = (crop.left - crop.right) / 2;
  const localCenterY = (crop.top - crop.bottom) / 2;
  const centerX = layout.x + layout.width / 2 + localCenterX * cosine - localCenterY * sine;
  const centerY = layout.y + layout.height / 2 + localCenterX * sine + localCenterY * cosine;
  const halfWidth = ((layout.width - crop.left - crop.right) * Math.abs(cosine)
    + (layout.height - crop.top - crop.bottom) * Math.abs(sine)) / 2;
  const halfHeight = ((layout.width - crop.left - crop.right) * Math.abs(sine)
    + (layout.height - crop.top - crop.bottom) * Math.abs(cosine)) / 2;
  return { left: centerX - halfWidth, right: centerX + halfWidth, top: centerY - halfHeight,
    bottom: centerY + halfHeight, centerX, centerY };
}

/** Crop insets scale with the resize, matching applyCrop's existing editorial contract. */
export function compositionCanvasResizedVisibleBounds(layout: CanvasGuideLayout, crop: CanvasGuideCrop, width: number, height: number) {
  return compositionCanvasVisibleBounds({ ...layout, width, height }, {
    left: crop.left * width / layout.width, right: crop.right * width / layout.width,
    top: crop.top * height / layout.height, bottom: crop.bottom * height / layout.height,
  });
}

export function resolveCompositionVisibleResizeSnap(input: {
  layout: CanvasGuideLayout; crop: CanvasGuideCrop; width: number; height: number;
  preserveRatio: boolean; guidesX: number[]; guidesY: number[]; threshold: number;
}) {
  const { layout, crop, width, height, preserveRatio, threshold } = input;
  const unchanged = { width, height, guideX: undefined as number | undefined, guideY: undefined as number | undefined };
  const bounds = compositionCanvasResizedVisibleBounds(layout, crop, width, height);
  if (!bounds || !Number.isFinite(threshold) || threshold < 0) return unchanged;
  const nearest = (position: number, guides: number[]) => {
    let match: { guide: number; delta: number } | null = null;
    for (const guide of guides) {
      const delta = guide - position;
      if (!Number.isFinite(delta) || Math.abs(delta) > threshold) continue;
      if (!match || Math.abs(delta) < Math.abs(match.delta)) match = { guide, delta };
    }
    return match;
  };
  const xMatch = nearest(bounds.right, input.guidesX);
  const yMatch = nearest(bounds.bottom, input.guidesY);
  if (!xMatch && !yMatch) return unchanged;
  const ratio = layout.width / layout.height;
  const widthBounds = compositionCanvasResizedVisibleBounds(layout, crop, width + 1, height + (preserveRatio ? 1 / ratio : 0));
  const heightBounds = compositionCanvasResizedVisibleBounds(layout, crop, width, height + 1);
  if (!widthBounds || !heightBounds) return unchanged;
  const xx = widthBounds.right - bounds.right;
  const yx = widthBounds.bottom - bounds.bottom;
  const xy = heightBounds.right - bounds.right;
  const yy = heightBounds.bottom - bounds.bottom;
  const epsilon = 1e-9;
  let deltaWidth = 0;
  let deltaHeight = 0;
  let guideX: number | undefined;
  let guideY: number | undefined;
  const determinant = xx * yy - xy * yx;
  if (!preserveRatio && xMatch && yMatch && Math.abs(determinant) > epsilon) {
    deltaWidth = (xMatch.delta * yy - xy * yMatch.delta) / determinant;
    deltaHeight = (xx * yMatch.delta - xMatch.delta * yx) / determinant;
    guideX = xMatch.guide;
    guideY = yMatch.guide;
  } else {
    const usableX = xMatch && (preserveRatio ? Math.abs(xx) > epsilon : Math.max(Math.abs(xx), Math.abs(xy)) > epsilon) ? xMatch : null;
    const usableY = yMatch && (preserveRatio ? Math.abs(yx) > epsilon : Math.max(Math.abs(yx), Math.abs(yy)) > epsilon) ? yMatch : null;
    if (!usableX && !usableY) return unchanged;
    const useX = usableX && (!usableY || Math.abs(usableX.delta) <= Math.abs(usableY.delta));
    const match = useX ? usableX! : usableY!;
    const widthCoefficient = useX ? xx : yx;
    const heightCoefficient = useX ? xy : yy;
    if (preserveRatio || Math.abs(widthCoefficient) >= Math.abs(heightCoefficient)) {
      deltaWidth = match.delta / widthCoefficient;
      deltaHeight = preserveRatio ? deltaWidth / ratio : 0;
    } else deltaHeight = match.delta / heightCoefficient;
    if (useX) guideX = match.guide;
    else guideY = match.guide;
  }
  const result = { width: width + deltaWidth, height: height + deltaHeight, guideX, guideY };
  return Number.isFinite(result.width) && Number.isFinite(result.height) && result.width > 0 && result.height > 0 ? result : unchanged;
}

export function renderCompositionCanvasVisibleBounds(): string {
  return `
      const compositionCanvasVisibleBounds = (${compositionCanvasVisibleBounds.toString()});
      const compositionCanvasResizedVisibleBounds = (${compositionCanvasResizedVisibleBounds.toString()});
      const resolveVisibleResizeSnap = (${resolveCompositionVisibleResizeSnap.toString()});
  `;
}

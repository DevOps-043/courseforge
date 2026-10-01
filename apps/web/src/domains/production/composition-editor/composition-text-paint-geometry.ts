export type PaintPoint = {x: number; y: number};
type Rectangle = {left: number; top: number; right: number; bottom: number};

/** Convex clipping keeps rotated support precise; bounding boxes alone cannot prove absence. */
function clipToRectangle(points: PaintPoint[], rectangle: Rectangle): PaintPoint[] {
  let polygon = points;
  for (const [axis, boundary, keepGreater] of [
    ["x", rectangle.left, true], ["x", rectangle.right, false],
    ["y", rectangle.top, true], ["y", rectangle.bottom, false],
  ] as const) {
    const input = polygon;
    polygon = [];
    if (!input.length) break;
    let previous = input[input.length - 1]!;
    let previousInside = keepGreater ? previous[axis] >= boundary : previous[axis] <= boundary;
    for (const current of input) {
      const currentInside = keepGreater ? current[axis] >= boundary : current[axis] <= boundary;
      if (currentInside !== previousInside) {
        const fraction = (boundary - previous[axis]) / (current[axis] - previous[axis]);
        const intersection = {x: previous.x + fraction * (current.x - previous.x),
          y: previous.y + fraction * (current.y - previous.y)};
        intersection[axis] = boundary;
        polygon.push(intersection);
      }
      if (currentInside) polygon.push(current);
      previous = current; previousInside = currentInside;
    }
  }
  return polygon;
}

/** Only the scheduler's rectangular percentage inset syntax is accepted; no guessed CSS masks. */
export function parseTextPaintInset(clipPath: string): [number, number, number, number] {
  if (clipPath === "none") return [0, 0, 0, 0];
  const match = /^inset\(([^()]+)\)$/.exec(clipPath);
  const values = match?.[1]?.trim().split(/\s+/);
  if (!values || values.length < 1 || values.length > 4) throw new Error("CONFORMANCE_TEXT_PAINT_MASK_UNSUPPORTED");
  const percentages = values.map((value) => {
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:%|px)?$/.test(value)
      || (!value.endsWith("%") && Number(value.replace(/px$/, "")) !== 0)) {
      throw new Error("CONFORMANCE_TEXT_PAINT_MASK_UNSUPPORTED");
    }
    const percent = Number(value.replace(/(?:%|px)$/, ""));
    if (!Number.isFinite(percent) || percent > 100) throw new Error("CONFORMANCE_TEXT_PAINT_MASK_UNSUPPORTED");
    return percent / 100;
  });
  const top = percentages[0]!, right = percentages[1] ?? top;
  return [top, right, percentages[2] ?? top, percentages[3] ?? right];
}

/**
 * Native subject support, not a glyph mask: centered motion is clipped by the parent's
 * overflow/inset before its top-left layout rotation/transition translation and canvas clip.
 * This describes unfiltered support only. Blur/filter expansion must be evaluated separately;
 * nonempty support does not prove visible glyphs.
 */
export function projectTextPaintGeometry(input: {
  canvas: {width: number; height: number};
  layout: {x: number; y: number; width: number; height: number; rotation: number};
  motion: {x: number; y: number; scale: number; rotation: number};
  transition: {xPercent: number; yPercent: number; clipPath: string};
}) {
  const {canvas, layout, motion, transition} = input;
  if (![canvas.width, canvas.height, ...Object.values(layout), ...Object.values(motion),
    transition.xPercent, transition.yPercent].every(Number.isFinite)
    || canvas.width <= 0 || canvas.height <= 0 || layout.width <= 0 || layout.height <= 0) {
    throw new Error("CONFORMANCE_TEXT_PAINT_GEOMETRY_INVALID");
  }
  const [top, right, bottom, left] = parseTextPaintInset(transition.clipPath);
  const clip = {left: left * layout.width, top: top * layout.height,
    right: (1 - right) * layout.width, bottom: (1 - bottom) * layout.height};
  if (clip.right <= clip.left || clip.bottom <= clip.top || motion.scale === 0) return {polygon: [] as PaintPoint[], empty: true};
  const subjectAngle = motion.rotation * Math.PI / 180, layoutAngle = layout.rotation * Math.PI / 180;
  const centerX = layout.width / 2, centerY = layout.height / 2;
  const subject = [[0, 0], [layout.width, 0], [layout.width, layout.height], [0, layout.height]].map(([x, y]) => {
    const scaledX = (x! - centerX) * motion.scale, scaledY = (y! - centerY) * motion.scale;
    return {x: centerX + motion.x + scaledX * Math.cos(subjectAngle) - scaledY * Math.sin(subjectAngle),
      y: centerY + motion.y + scaledX * Math.sin(subjectAngle) + scaledY * Math.cos(subjectAngle)};
  });
  if (subject.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error("CONFORMANCE_TEXT_PAINT_GEOMETRY_INVALID");
  }
  const clippedSubject = clipToRectangle(subject, clip);
  const positioned = clippedSubject.map(({x, y}) => ({
    x: layout.x + layout.width * transition.xPercent / 100 + x * Math.cos(layoutAngle) - y * Math.sin(layoutAngle),
    y: layout.y + layout.height * transition.yPercent / 100 + x * Math.sin(layoutAngle) + y * Math.cos(layoutAngle),
  }));
  if (positioned.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error("CONFORMANCE_TEXT_PAINT_GEOMETRY_INVALID");
  }
  const polygon = clipToRectangle(positioned, {left: 0, top: 0, right: canvas.width, bottom: canvas.height});
  const twiceArea = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  // Degenerate boundary contact has no area and must not be treated as painted support.
  return Math.abs(twiceArea) > 0 ? {polygon, empty: false} : {polygon: [] as PaintPoint[], empty: true};
}

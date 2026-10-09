import { HtmlEditingValidationError } from "./html-editing-validation";

const number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const pixelLength = new RegExp(`^(${number})(?:px)?$`);
const alignment = /^(none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(meet|slice))?$/;
function reject(): never { throw new HtmlEditingValidationError("INVALID_SOURCE"); }

/** SVG2 8.2 attribute mapping only: CSS/relative viewport sizing needs separate
 * computed-layout authority. null is unproven, NOT an identity transform.
 * Returned norm envelope includes alignment and origin translation. */
export function readHtmlEditingSvgViewportBudget(attributes: Readonly<Record<string, string>>):
  Readonly<{ scale: number; translation: number }> | null {
  const aspectRatio = attributes.preserveAspectRatio ?? attributes.preserveaspectratio ?? "xMidYMid meet";
  const matchedAlignment = alignment.exec(aspectRatio.trim());
  if (!matchedAlignment) reject();
  const rawViewBox = attributes.viewBox ?? attributes.viewbox;
  if (rawViewBox === undefined) return null;
  const parts = rawViewBox.trim().split(/[\s,]+/);
  const numeric = new RegExp(`^${number}$`);
  if (parts.length !== 4 || parts.some(part => !numeric.test(part))) reject();
  const [minX, minY, width, height] = parts.map(Number);
  if (![minX, minY, width, height].every(Number.isFinite) || width <= 0 || height <= 0
    || ![1 / width, 1 / height, minX / width, minY / height].every(Number.isFinite)) reject();
  const pixels = (value: string | undefined): number | null => {
    if (value === undefined) return null;
    const match = pixelLength.exec(value.trim());
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) reject();
    return amount;
  };
  const viewportWidth = pixels(attributes.width), viewportHeight = pixels(attributes.height);
  const originX = pixels(attributes.x ?? "0"), originY = pixels(attributes.y ?? "0");
  if (viewportWidth === null || viewportHeight === null || originX === null || originY === null) return null;
  if (viewportWidth < 0 || viewportHeight < 0) reject();
  if (viewportWidth === 0 || viewportHeight === 0) return { scale: 1, translation: 0 }; // Disabled viewport.
  let scaleX = viewportWidth / width, scaleY = viewportHeight / height;
  const align = matchedAlignment[1], mode = matchedAlignment[2] ?? "meet";
  if (align !== "none") scaleX = scaleY = mode === "slice" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  let translateX = originX - minX * scaleX, translateY = originY - minY * scaleY;
  if (align.includes("xMid")) translateX += (viewportWidth - width * scaleX) / 2;
  if (align.includes("xMax")) translateX += viewportWidth - width * scaleX;
  if (align.includes("YMid")) translateY += (viewportHeight - height * scaleY) / 2;
  if (align.includes("YMax")) translateY += viewportHeight - height * scaleY;
  const scale = Math.max(1, scaleX, scaleY), translation = Math.hypot(translateX, translateY);
  if (![scale, translation].every(Number.isFinite)) reject();
  return { scale, translation };
}

import { z } from "zod";

export const HTML_EDITING_STYLE_RANGE_POLICY = Object.freeze({
  FONT_SIZE: { cssProperty: "font-size", unit: "px", minimum: 8, maximum: 144 },
  LETTER_SPACING: { cssProperty: "letter-spacing", unit: "px", minimum: -8, maximum: 32 },
  LINE_HEIGHT: { cssProperty: "line-height", unit: "", minimum: 0.5, maximum: 4 },
  OPACITY: { cssProperty: "opacity", unit: "", minimum: 0, maximum: 1 },
  BORDER_RADIUS: { cssProperty: "border-radius", unit: "px", minimum: 0, maximum: 128 },
});
export const htmlEditingStyleRangePropertySchema = z.enum(["FONT_SIZE", "LETTER_SPACING", "LINE_HEIGHT", "OPACITY", "BORDER_RADIUS"]);
export const htmlEditingStyleRangeSchema = z.object({
  property: htmlEditingStyleRangePropertySchema,
  minimum: z.number().finite(), maximum: z.number().finite(), step: z.number().finite().positive(),
  defaultValue: z.number().finite(),
}).strict().superRefine((range, context) => {
  const policy = HTML_EDITING_STYLE_RANGE_POLICY[range.property];
  if (range.minimum < policy.minimum || range.maximum > policy.maximum || range.minimum >= range.maximum
    || range.step > range.maximum - range.minimum || (range.maximum - range.minimum) / range.step > 1_000_000
    || !isHtmlEditingStyleRangeValue(range, range.defaultValue)
    || !isHtmlEditingStyleRangeValue(range, range.maximum))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid declared style range" });
});
export type HtmlEditingStyleRange = z.infer<typeof htmlEditingStyleRangeSchema>;
/** Decimal inputs remain numeric; step tolerance accommodates binary floating
 * representation, not rounding/clamping arbitrary client values into policy. */
export function isHtmlEditingStyleRangeValue(range: { minimum: number; maximum: number; step: number }, value: number): boolean {
  if (!Number.isFinite(value) || value < range.minimum || value > range.maximum || !Number.isFinite(range.step) || range.step <= 0) return false;
  const position = (value - range.minimum) / range.step;
  return Math.abs(position - Math.round(position)) <= 1e-8;
}
export function formatHtmlEditingStyleRangeValue(range: HtmlEditingStyleRange, value: number): string {
  if (!isHtmlEditingStyleRangeValue(range, value)) throw new Error("HTML_EDITING_INVALID_STYLE_RANGE_VALUE");
  return `${Object.is(value, -0) ? 0 : value}${HTML_EDITING_STYLE_RANGE_POLICY[range.property].unit}`;
}

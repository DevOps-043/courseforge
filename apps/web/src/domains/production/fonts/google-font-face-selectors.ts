import { isGoogleFontUnicodeRange } from "./google-font-preparation-policy";

export type GoogleFontFaceSelector = { style: "normal" | "italic"; weight: { minimum: number; maximum: number }; unicodeRange: string | null };
export function googleFontUnicodeIntervals(unicodeRange: string | null): Array<[number, number]> {
  if (unicodeRange === null) return [[0, 0x10ffff]];
  if (!isGoogleFontUnicodeRange(unicodeRange)) throw new Error("GOOGLE_FONT_UNICODE_RANGE_INVALID");
  return unicodeRange.split(",").map(part => {
    const value = part.trim().replace(/^U\+/i, "");
    if (value.includes("?")) return [parseInt(value.replace(/\?/g, "0"), 16), parseInt(value.replace(/\?/g, "F"), 16)];
    const [first, last = first] = value.split("-");
    return [parseInt(first, 16), parseInt(last, 16)];
  });
}
export function googleFontSelectorsOverlap(first: GoogleFontFaceSelector, second: GoogleFontFaceSelector) {
  return first.style === second.style && first.weight.minimum <= second.weight.maximum && second.weight.minimum <= first.weight.maximum
    && googleFontUnicodeIntervals(first.unicodeRange).some(range => googleFontUnicodeIntervals(second.unicodeRange)
      .some(other => range[0] <= other[1] && range[1] >= other[0]));
}

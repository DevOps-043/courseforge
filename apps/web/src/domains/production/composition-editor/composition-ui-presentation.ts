import { formatCompositionTimecode } from "./composition-timecode";

// Spanish UI default; presentation only, never document serialization or canonical timecode parsing.
export const COMPOSITION_UI_LOCALE = "es-MX";
const MAX_PRESENTATION_FORMATTERS = 16;
const numberFormatters = new Map<string, Intl.NumberFormat>();

function presentationFormatter(locale: string, fractionDigits: number): Intl.NumberFormat {
  const key = `${locale}:${fractionDigits}`;
  const cached = numberFormatters.get(key);
  if (cached) return cached;
  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: fractionDigits });
  } catch {
    formatter = new Intl.NumberFormat(COMPOSITION_UI_LOCALE, { useGrouping: false, maximumFractionDigits: fractionDigits });
  }
  if (numberFormatters.size >= MAX_PRESENTATION_FORMATTERS) numberFormatters.delete(numberFormatters.keys().next().value!);
  numberFormatters.set(key, formatter);
  return formatter;
}

export function formatCompositionUiNumber(value: number, fractionDigits = 2, locale = COMPOSITION_UI_LOCALE): string {
  if (!Number.isFinite(value)) return "—";
  const precision = Number.isFinite(fractionDigits) ? Math.max(0, Math.min(6, Math.round(fractionDigits))) : 2;
  return presentationFormatter(locale, precision).format(value);
}

/** Local digits/decimal mark, canonical colon fields and millisecond precision. Not an editable/storage representation. */
export function formatCompositionUiTimecode(value: number, locale = COMPOSITION_UI_LOCALE): string {
  const canonical = formatCompositionTimecode(value);
  if (!canonical) return "—";
  const formatter = presentationFormatter(locale, 3);
  const decimalMark = formatter.formatToParts(1.1).find((part) => part.type === "decimal")?.value || ".";
  return canonical.replace(/\d/g, (digit) => formatter.format(Number(digit))).replace(".", decimalMark);
}

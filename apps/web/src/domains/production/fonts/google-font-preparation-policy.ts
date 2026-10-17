import { z } from "zod";

export const GOOGLE_FONT_PREPARATION_POLICY = Object.freeze({
  stylesheetBytes: 64 * 1024,
  maximumFaces: 32,
  totalFontBytes: 20 * 1024 * 1024,
  timeoutMs: 20_000,
  concurrentPreparations: 2,
  queuedPreparations: 2,
  queueTimeoutMs: 2_000,
  manifestBytes: 256 * 1024,
  requestBytes: 1024,
  clientTimeoutMs: 30_000,
});

export const googleFontPreparationInputSchema = z.object({
  family: z.string().trim().regex(/^[a-zA-Z0-9 ._-]+$/).min(1).max(120),
  cssUrl: z.string().url().max(2_000),
}).strict().superRefine((input, context) => {
  if (!isGoogleFontPreparationUrl(input.cssUrl, input.family)) {
    context.addIssue({ code: "custom", path: ["cssUrl"], message: "GOOGLE_FONT_PREPARATION_URL_INVALID" });
  }
});

/** Download policy is deliberately narrower than the legacy stylesheet selector.
 * One exact family; no text-specific subsets, arbitrary endpoints or redirects. */
export function isGoogleFontPreparationUrl(value: string, family: string) {
  try {
    const url = new URL(value);
    if (url.origin !== "https://fonts.googleapis.com" || url.username || url.password || url.hash
      || !["/css", "/css2"].includes(url.pathname)) return false;
    const allowed = new Set(["family", "display", "subset"]);
    if ([...url.searchParams.keys()].some(key => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) return false;
    const requested = url.searchParams.get("family");
    if (!requested || requested.split(":", 1)[0] !== family || requested.length > 600
      || !/^[a-zA-Z0-9 ._:;,@-]+$/.test(requested)) return false;
    const display = url.searchParams.get("display"), subset = url.searchParams.get("subset");
    return (display === null || ["auto", "block", "swap", "fallback", "optional"].includes(display))
      && (subset === null || subset.length <= 128 && /^[a-z-]+(?:,[a-z-]+)*$/.test(subset));
  } catch { return false; }
}

export function googleFontBinaryExtension(value: string) {
  const url = new URL(value);
  const match = /^\/s\/[a-z0-9]+\/v\d+\/[a-zA-Z0-9_-]+\.(woff2|woff|ttf|otf)$/.exec(url.pathname);
  if (url.origin !== "https://fonts.gstatic.com" || url.username || url.password || url.search || url.hash || !match) {
    throw new Error("GOOGLE_FONT_BINARY_URL_INVALID");
  }
  return match[1] as "woff2" | "woff" | "ttf" | "otf";
}

export function isGoogleFontUnicodeRange(value: string) {
  if (value.length > 4096) return false;
  const ranges = value.split(",");
  return ranges.length <= 128 && ranges.every(range => {
    const wildcard = /^\s*U\+([a-fA-F0-9]*\?+)\s*$/.exec(range);
    if (wildcard) return wildcard[1].length <= 6 && parseInt(wildcard[1].replace(/\?/g, "F"), 16) <= 0x10ffff;
    const parsed = /^\s*U\+([a-fA-F0-9]{1,6})(?:-([a-fA-F0-9]{1,6}))?\s*$/.exec(range);
    if (!parsed) return false;
    const start = parseInt(parsed[1], 16), end = parseInt(parsed[2] ?? parsed[1], 16);
    return start <= end && end <= 0x10ffff;
  });
}

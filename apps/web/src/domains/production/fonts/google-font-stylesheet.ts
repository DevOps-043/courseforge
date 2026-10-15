import { GOOGLE_FONT_PREPARATION_POLICY, googleFontBinaryExtension, isGoogleFontUnicodeRange } from "./google-font-preparation-policy";
import { organizationFontFormat } from "./organization-font-upload-policy.service";

export type GoogleFontFace = {
  family: string;
  style: "normal" | "italic";
  weight: { minimum: number; maximum: number };
  unicodeRange: string | null;
  sourceUrl: string;
  extension: ReturnType<typeof googleFontBinaryExtension>;
};

const allowedDescriptors = new Set(["font-family", "font-style", "font-weight", "font-stretch", "font-display", "src", "unicode-range"]);

/** A narrow data parser, not a CSS evaluator. Never inject the provider stylesheet. */
export function parseGoogleFontStylesheet(css: string, expectedFamily: string): GoogleFontFace[] {
  if (Buffer.byteLength(css) > GOOGLE_FONT_PREPARATION_POLICY.stylesheetBytes || /[\\\u0000]/.test(css)) throw new Error("GOOGLE_FONT_STYLESHEET_INVALID");
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...stripped.matchAll(/@font-face\s*\{([^{}]*)\}/g)];
  if (!blocks.length || blocks.length > GOOGLE_FONT_PREPARATION_POLICY.maximumFaces
    || stripped.replace(/@font-face\s*\{([^{}]*)\}/g, "").trim()) throw new Error("GOOGLE_FONT_STYLESHEET_INVALID");
  const identities = new Set<string>();
  return blocks.map(block => {
    const declarations = new Map<string, string>();
    for (const declaration of block[1].split(";").map(value => value.trim()).filter(Boolean)) {
      const separator = declaration.indexOf(":");
      const name = declaration.slice(0, separator).trim(), value = declaration.slice(separator + 1).trim();
      if (separator < 1 || !allowedDescriptors.has(name) || declarations.has(name) || !value) throw new Error("GOOGLE_FONT_STYLESHEET_INVALID");
      declarations.set(name, value);
    }
    const quotedFamily = declarations.get("font-family") ?? "";
    const family = /^(['"])([a-zA-Z0-9 ._-]+)\1$/.exec(quotedFamily)?.[2] ?? quotedFamily;
    const style = declarations.get("font-style") ?? "normal";
    const display = declarations.get("font-display"), stretch = declarations.get("font-stretch");
    if (family !== expectedFamily || !["normal", "italic"].includes(style)
      || stretch !== undefined && !["normal", "100%"].includes(stretch)
      || display !== undefined && !["auto", "block", "swap", "fallback", "optional"].includes(display)) throw new Error("GOOGLE_FONT_STYLESHEET_INVALID");
    const weightText = declarations.get("font-weight") ?? "400";
    const weights = /^(\d{1,4})(?:\s+(\d{1,4}))?$/.exec(weightText === "normal" ? "400" : weightText === "bold" ? "700" : weightText);
    const minimum = Number(weights?.[1]), maximum = Number(weights?.[2] ?? weights?.[1]);
    if (!weights || minimum < 1 || maximum > 1000 || minimum > maximum) throw new Error("GOOGLE_FONT_STYLESHEET_INVALID");
    const source = /^url\(\s*(['"]?)(https:\/\/[^'"()\s]+)\1\s*\)\s+format\(\s*(['"])([a-z0-9]+)\3\s*\)$/.exec(declarations.get("src") ?? "");
    if (!source) throw new Error("GOOGLE_FONT_STYLESHEET_INVALID");
    const extension = googleFontBinaryExtension(source[2]);
    if (organizationFontFormat(extension) !== source[4]) throw new Error("GOOGLE_FONT_STYLESHEET_INVALID");
    const unicodeRange = declarations.get("unicode-range") ?? null;
    if (unicodeRange && !isGoogleFontUnicodeRange(unicodeRange)) throw new Error("GOOGLE_FONT_STYLESHEET_INVALID");
    const identity = JSON.stringify([style, minimum, maximum, unicodeRange]);
    if (identities.has(identity)) throw new Error("GOOGLE_FONT_STYLESHEET_INVALID");
    identities.add(identity);
    return { family, style: style as GoogleFontFace["style"], weight: { minimum, maximum }, unicodeRange, sourceUrl: source[2], extension };
  });
}


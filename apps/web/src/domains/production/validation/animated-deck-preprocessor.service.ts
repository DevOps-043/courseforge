export const ANIMATED_DECK_SCHEMA_VERSION = "animated-deck-v1";

export const ANIMATED_DECK_WIDTH = 1920;
export const ANIMATED_DECK_HEIGHT = 1080;

const MAX_SLIDES = 80;
const MAX_HTML_BYTES = 650_000;
const MAX_CSS_BYTES = 260_000;
const MAX_GOOGLE_FONT_FAMILIES = 3;

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const SLIDE_RE =
  /<section\b(?=[^>]*\bclass=(["'])[^"']*\bslide\b[^"']*\1)[\s\S]*?<\/section>/gi;
const LINK_STYLESHEET_RE = /<link\b[^>]*rel=(["'])stylesheet\1[^>]*>/gi;
const EVENT_ATTRIBUTE_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const FORBIDDEN_TAG_RE = /<(iframe|object|embed|base|form|input|button|textarea|select)\b/i;
const CONTROLLER_RESIDUE_RE =
  /data-od-|deck-prev|deck-next|deck-counter|deck-hint|localStorage|sessionStorage|addEventListener\(['"]keydown|postMessage\(|\bfetch\s*\(|XMLHttpRequest|WebSocket/i;
const REMOTE_URL_RE = /https?:\/\//i;

interface ExtractedSlide {
  index: number;
  label: string;
  markup: string;
}

export interface AnimatedDeckFont {
  family: string;
  source: "google";
  href: string;
  weights?: string[];
}

export interface AnimatedDeckSlide {
  index: number;
  label: string;
  classes: string;
  html: string;
  animationCount: number;
}

export interface AnimatedDeckDocument {
  schemaVersion: typeof ANIMATED_DECK_SCHEMA_VERSION;
  width: number;
  height: number;
  slides: AnimatedDeckSlide[];
}

export interface AnimatedDeckRemoteAsset {
  source_url: string;
  storage_path: string;
  public_url: string;
  content_type: string;
  bytes: number;
  status?: "imported" | "placeholder";
  fallback_reason?: string;
}

export interface AnimatedDeckCleanupReport {
  slideCount: number;
  removedScripts: number;
  removedControllerNodes: number;
  removedEventAttributes: number;
  removedOperationalNotes: number;
  removedFontLinks: number;
  removedImports: number;
  scopedCssBytes: number;
  hasControllerResidue: boolean;
}

export interface AnimatedDeckValidationReport {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  htmlBytes: number;
  cssBytes: number;
  fontCount: number;
}

export interface PreparedAnimatedDeck {
  deck: AnimatedDeckDocument;
  css: string;
  fonts: AnimatedDeckFont[];
  remoteAssets: AnimatedDeckRemoteAsset[];
  cleanup: AnimatedDeckCleanupReport;
  validation: AnimatedDeckValidationReport;
  animatedSlideCount: number;
  staticSlideCount: number;
}

export interface PrepareAnimatedDeckOptions {
  allowedRemoteAssetUrls?: string[];
  remoteAssets?: AnimatedDeckRemoteAsset[];
}

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function countMatches(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length;
}

function readAttribute(markup: string, attr: string): string | null {
  const match = markup.match(new RegExp(`\\b${attr}=(["'])(.*?)\\1`, "i"));
  return match?.[2] ?? null;
}

function extractHref(markup: string): string | null {
  return readAttribute(markup, "href");
}

function parseGoogleFontHref(href: string): AnimatedDeckFont | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.hostname !== "fonts.googleapis.com") {
    return null;
  }

  const familyParam = url.searchParams.get("family");
  if (!familyParam) {
    return null;
  }

  const [familyRaw, axisRaw] = familyParam.split(":");
  const family = decodeURIComponent(familyRaw.replace(/\+/g, " ")).trim();
  const weights = axisRaw
    ? Array.from(new Set(axisRaw.match(/\d{3}/g) ?? []))
    : undefined;

  return family
    ? {
        family,
        href: url.toString(),
        source: "google",
        weights,
      }
    : null;
}

function normalizeRemoteUrlForComparison(rawUrl: string) {
  return rawUrl.replace(/&amp;/g, "&");
}

function isGoogleFontUrl(rawUrl: string, fonts: AnimatedDeckFont[] = []) {
  let url: URL;
  try {
    url = new URL(normalizeRemoteUrlForComparison(rawUrl));
  } catch {
    return false;
  }

  const allowedFontUrls = new Set(fonts.map((font) => font.href));
  return (
    url.hostname === "fonts.gstatic.com" ||
    (url.hostname === "fonts.googleapis.com" && allowedFontUrls.has(url.toString()))
  );
}

function mergeFonts(fonts: AnimatedDeckFont[]): AnimatedDeckFont[] {
  const byHref = new Map<string, AnimatedDeckFont>();
  for (const font of fonts) {
    byHref.set(font.href, font);
  }
  return Array.from(byHref.values()).slice(0, MAX_GOOGLE_FONT_FAMILIES);
}

function extractGoogleFontLinks(html: string) {
  const fonts: AnimatedDeckFont[] = [];
  const htmlWithoutLinks = html.replace(LINK_STYLESHEET_RE, (tag) => {
    const href = extractHref(tag);
    const font = href ? parseGoogleFontHref(href) : null;
    if (font) {
      fonts.push(font);
      return "";
    }
    return tag;
  });

  return {
    fonts,
    html: htmlWithoutLinks,
    removedFontLinks: fonts.length,
  };
}

function extractGoogleFontImports(css: string) {
  const fonts: AnimatedDeckFont[] = [];
  let removedImports = 0;
  const cssWithoutImports = css.replace(
    /@import\s+(?:url\()?["']?(https:\/\/fonts\.googleapis\.com\/[^"')\s]+)["']?\)?\s*;?/gi,
    (_full, href: string) => {
      removedImports += 1;
      const font = parseGoogleFontHref(href);
      if (font) {
        fonts.push(font);
      }
      return "";
    },
  );

  return { css: cssWithoutImports, fonts, removedImports };
}

function blockEnd(css: string, openIdx: number) {
  let depth = 0;
  for (let index = openIdx; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return css.length;
}

function dropRules(css: string, matches: (selector: string) => boolean) {
  let out = "";
  let index = 0;

  while (index < css.length) {
    const open = css.indexOf("{", index);
    if (open === -1) {
      out += css.slice(index);
      break;
    }

    const selector = css.slice(index, open).trim();
    const end = blockEnd(css, open);
    if (!matches(selector)) {
      out += css.slice(index, end);
    }
    index = end;
  }

  return out;
}

function isControlChromeSelector(selector: string) {
  return (
    /(^|[\s,])(html|body)\b/.test(selector) ||
    selector.includes(".deck-shell") ||
    selector.includes(".deck-counter") ||
    selector.includes(".deck-hint") ||
    selector.startsWith("@media print")
  );
}

function scopeSelector(selector: string) {
  return selector
    .split(",")
    .map((raw) => {
      const value = raw.trim();
      if (!value) return value;
      if (value === ":root") return ".deck-scope";
      if (value === "*") return ".deck-scope *";
      if (value.startsWith(".deck-scope")) return value;
      return `.deck-scope ${value}`;
    })
    .join(", ");
}

function scopeCss(css: string): string {
  let out = "";
  let index = 0;

  while (index < css.length) {
    const open = css.indexOf("{", index);
    if (open === -1) {
      out += css.slice(index);
      break;
    }

    const head = css.slice(index, open);
    const selector = head.trim();
    const end = blockEnd(css, open);
    const body = css.slice(open + 1, end - 1);

    if (
      selector.startsWith("@keyframes") ||
      selector.startsWith("@font-face") ||
      selector.startsWith("@page")
    ) {
      out += css.slice(index, end);
    } else if (
      selector.startsWith("@media") ||
      selector.startsWith("@supports") ||
      selector.startsWith("@container")
    ) {
      out += `${head}{${scopeCss(body)}}`;
    } else {
      const lead = head.slice(0, head.length - head.trimStart().length);
      out += `${lead}${scopeSelector(selector)}{${body}}`;
    }

    index = end;
  }

  return out;
}

function timeToSeconds(token: string) {
  return token.endsWith("ms")
    ? parseFloat(token) / 1000
    : parseFloat(token);
}

function tokenizeAnimation(value: string) {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";

  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (/\s/.test(character) && depth === 0) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  if (current) tokens.push(current);
  return tokens;
}

function makeAnimationsDeterministic(css: string) {
  return css.replace(/animation:\s*([^;]+);/g, (_full, value: string) => {
    const tokens = tokenizeAnimation(value);
    const times = tokens.filter((token) => /^[\d.]+m?s$/.test(token));
    const delay = times.length > 1 ? timeToSeconds(times[1]) : 0;

    return `animation: ${value}; animation-delay: calc(${delay}s - var(--deck-t, 0) * 1s); animation-play-state: paused;`;
  });
}

function extractSlides(html: string): ExtractedSlide[] {
  return Array.from(html.matchAll(SLIDE_RE), (match, index) => {
    const markup = match[0];
    return {
      index: index + 1,
      label: readAttribute(markup, "data-screen-label") || `Slide ${index + 1}`,
      markup,
    };
  });
}

function stripOuterSection(markup: string) {
  return markup.replace(/^<section\b[^>]*>/i, "").replace(/<\/section>\s*$/i, "");
}

function readSectionClasses(markup: string) {
  const classAttr = readAttribute(markup, "class") || "slide";
  return classAttr
    .split(/\s+/)
    .filter((className) => className && className !== "active")
    .join(" ");
}

function cleanSlideInnerHtml(markup: string) {
  let removedOperationalNotes = 0;
  let removedEventAttributes = 0;

  let html = stripOuterSection(markup)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<div\b[^>]*class=(["'])avatar-box\1[^>]*>\s*<\/div>/gi, "");

  html = html.replace(/<div\b[^>]*>\s*\[[^<]*\]\s*<\/div>/gi, () => {
    removedOperationalNotes += 1;
    return "";
  });

  html = html.replace(EVENT_ATTRIBUTE_RE, () => {
    removedEventAttributes += 1;
    return "";
  });

  return { html: html.trim(), removedEventAttributes, removedOperationalNotes };
}

function classNamesFromHtml(html: string) {
  const classNames = new Set<string>();
  for (const match of html.matchAll(/\bclass=(["'])(.*?)\1/gi)) {
    match[2]
      .split(/\s+/)
      .filter(Boolean)
      .forEach((className) => classNames.add(className));
  }
  return classNames;
}

function animatedSelectors(css: string) {
  const selectors: string[] = [];
  const ruleRe = /([^{}]+)\{[^{}]*animation:[^{}]+\}/gi;
  for (const match of css.matchAll(ruleRe)) {
    selectors.push(match[1].trim());
  }
  return selectors;
}

function countSlideAnimations(params: {
  css: string;
  slideClasses: string;
  slideHtml: string;
}) {
  const classes = classNamesFromHtml(
    `<section class="${params.slideClasses}">${params.slideHtml}</section>`,
  );
  let count = 0;

  for (const selector of animatedSelectors(params.css)) {
    const selectorClasses = Array.from(selector.matchAll(/\.([_a-zA-Z-][\w-]*)/g))
      .map((match) => match[1])
      .filter((className) => !["active", "deck-scope", "slide"].includes(className));
    if (selectorClasses.length === 0) {
      continue;
    }
    if (selectorClasses.some((className) => classes.has(className))) {
      count += 1;
    }
  }

  return count;
}

function assertSafeRemoteUrls(params: {
  allowedRemoteAssetUrls: string[];
  css: string;
  slideHtml: string;
  fonts: AnimatedDeckFont[];
  errors: string[];
}) {
  const allowedRemoteAssetUrls = new Set(
    params.allowedRemoteAssetUrls.map(normalizeRemoteUrlForComparison),
  );
  const combined = `${params.css}\n${params.slideHtml}`;
  for (const match of combined.matchAll(/https?:\/\/[^"')\s>]+/gi)) {
    const rawUrl = match[0];
    let url: URL;
    try {
      url = new URL(normalizeRemoteUrlForComparison(rawUrl));
    } catch {
      params.errors.push(`URL remota invalida: ${rawUrl}`);
      continue;
    }

    const isAllowedFont = isGoogleFontUrl(rawUrl, params.fonts);
    const isAllowedImportedAsset = allowedRemoteAssetUrls.has(url.toString());
    if (!isAllowedFont && !isAllowedImportedAsset) {
      params.errors.push(`URL remota no permitida en deck animado: ${rawUrl}`);
    }
  }
}

export function collectAnimatedDeckRemoteAssetUrls(sourceHtml: string): string[] {
  const fontLinks = extractGoogleFontLinks(sourceHtml);
  const htmlWithoutScripts = fontLinks.html.replace(SCRIPT_RE, "");
  const styleBlocks = Array.from(htmlWithoutScripts.matchAll(STYLE_RE), (match) => match[1]);
  const importedFonts = extractGoogleFontImports(styleBlocks.join("\n"));
  const fonts = mergeFonts([...fontLinks.fonts, ...importedFonts.fonts]);
  const urls = new Map<string, string>();

  for (const match of htmlWithoutScripts.matchAll(/https?:\/\/[^"')\s>]+/gi)) {
    const rawUrl = match[0];
    if (isGoogleFontUrl(rawUrl, fonts)) {
      continue;
    }
    urls.set(normalizeRemoteUrlForComparison(rawUrl), rawUrl);
  }

  return Array.from(urls.values());
}

export function rewriteAnimatedDeckRemoteAssetUrls(
  sourceHtml: string,
  urlMap: Record<string, string>,
): string {
  let html = sourceHtml;
  for (const [sourceUrl, targetUrl] of Object.entries(urlMap)) {
    html = html.split(sourceUrl).join(targetUrl);
    const normalizedSource = normalizeRemoteUrlForComparison(sourceUrl);
    if (normalizedSource !== sourceUrl) {
      html = html.split(normalizedSource).join(targetUrl);
    }
  }
  return html;
}

function buildFontImportCss(fonts: AnimatedDeckFont[]) {
  return fonts.map((font) => `@import url("${font.href}");`).join("\n");
}

function validatePreparedDeck(params: {
  allowedRemoteAssetUrls: string[];
  sourceHtml: string;
  css: string;
  fonts: AnimatedDeckFont[];
  slides: AnimatedDeckSlide[];
}) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const htmlBytes = byteLength(params.sourceHtml);
  const cssBytes = byteLength(params.css);
  const slideHtml = params.slides.map((slide) => slide.html).join("\n");

  if (htmlBytes > MAX_HTML_BYTES) {
    errors.push(`HTML supera el maximo permitido (${htmlBytes} bytes).`);
  }
  if (cssBytes > MAX_CSS_BYTES) {
    errors.push(`CSS supera el maximo permitido (${cssBytes} bytes).`);
  }
  if (params.slides.length === 0) {
    errors.push("No se encontraron diapositivas .slide.");
  }
  if (params.slides.length > MAX_SLIDES) {
    errors.push(`El deck tiene demasiadas diapositivas (${params.slides.length}).`);
  }
  if (params.fonts.length > MAX_GOOGLE_FONT_FAMILIES) {
    errors.push(`El deck declara mas de ${MAX_GOOGLE_FONT_FAMILIES} familias de Google Fonts.`);
  }
  if (FORBIDDEN_TAG_RE.test(slideHtml)) {
    errors.push("El deck contiene etiquetas HTML no permitidas para preview/render.");
  }
  if (/<script\b/i.test(slideHtml) || /<script\b/i.test(params.css)) {
    errors.push("El deck conserva scripts despues de la limpieza.");
  }
  if (EVENT_ATTRIBUTE_RE.test(slideHtml)) {
    errors.push("El deck conserva atributos de evento on* despues de la limpieza.");
  }
  for (const importMatch of params.css.matchAll(/@import\s+([^;]+);?/gi)) {
    if (!/fonts\.googleapis\.com/i.test(importMatch[1])) {
      errors.push("El deck contiene @import no permitido.");
    }
  }
  if (CONTROLLER_RESIDUE_RE.test(slideHtml) || CONTROLLER_RESIDUE_RE.test(params.css)) {
    errors.push("Quedaron residuos de controladores o APIs inseguras en el deck.");
  }
  if (!REMOTE_URL_RE.test(params.css) && params.fonts.length === 0) {
    warnings.push("El deck no declara Google Fonts; se usaran fuentes disponibles del navegador/worker.");
  }

  assertSafeRemoteUrls({
    allowedRemoteAssetUrls: params.allowedRemoteAssetUrls,
    css: params.css,
    errors,
    fonts: params.fonts,
    slideHtml,
  });

  return {
    cssBytes,
    errors,
    fontCount: params.fonts.length,
    htmlBytes,
    isValid: errors.length === 0,
    warnings,
  } satisfies AnimatedDeckValidationReport;
}

export function prepareAnimatedDeckForRemotion(
  sourceHtml: string,
  options: PrepareAnimatedDeckOptions = {},
): PreparedAnimatedDeck {
  const removedScripts = countMatches(sourceHtml, SCRIPT_RE);
  const fontLinks = extractGoogleFontLinks(sourceHtml);
  const htmlWithoutScripts = fontLinks.html.replace(SCRIPT_RE, "");
  const styleBlocks = Array.from(htmlWithoutScripts.matchAll(STYLE_RE), (match) => match[1]);
  const cssWithoutComments = styleBlocks.join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const importedFonts = extractGoogleFontImports(cssWithoutComments);
  const fonts = mergeFonts([...fontLinks.fonts, ...importedFonts.fonts]);
  const fontCss = buildFontImportCss(fonts);
  const rawCss = dropRules(importedFonts.css, isControlChromeSelector);
  const scopedCss = makeAnimationsDeterministic(scopeCss(rawCss));
  const css = [fontCss, scopedCss]
    .filter((part) => part.trim().length > 0)
    .join("\n")
    .trim();
  const slides = extractSlides(htmlWithoutScripts);

  let removedEventAttributes = 0;
  let removedOperationalNotes = 0;
  const preparedSlides = slides.map((slide) => {
    const cleaned = cleanSlideInnerHtml(slide.markup);
    removedEventAttributes += cleaned.removedEventAttributes;
    removedOperationalNotes += cleaned.removedOperationalNotes;
    const classes = readSectionClasses(slide.markup);

    return {
      animationCount: countSlideAnimations({
        css: scopedCss,
        slideClasses: classes,
        slideHtml: cleaned.html,
      }),
      classes,
      html: cleaned.html,
      index: slide.index,
      label: slide.label,
    };
  });

  const cleanup = {
    hasControllerResidue: preparedSlides.some((slide) => CONTROLLER_RESIDUE_RE.test(slide.html)) ||
      CONTROLLER_RESIDUE_RE.test(css),
    removedControllerNodes:
      countMatches(sourceHtml, /<nav\b(?=[^>]*\bclass=(["'])[^"']*\bdeck-counter\b[^"']*\1)[\s\S]*?<\/nav>/gi) +
      countMatches(sourceHtml, /<div\b(?=[^>]*\bclass=(["'])[^"']*\bdeck-hint\b[^"']*\1)[\s\S]*?<\/div>/gi),
    removedEventAttributes,
    removedFontLinks: fontLinks.removedFontLinks,
    removedImports: importedFonts.removedImports,
    removedOperationalNotes,
    removedScripts,
    scopedCssBytes: byteLength(css),
    slideCount: preparedSlides.length,
  } satisfies AnimatedDeckCleanupReport;
  const validation = validatePreparedDeck({
    allowedRemoteAssetUrls: options.allowedRemoteAssetUrls || [],
    css,
    fonts,
    slides: preparedSlides,
    sourceHtml,
  });
  const animatedSlideCount = preparedSlides.filter((slide) => slide.animationCount > 0).length;

  if (!validation.isValid) {
    throw new Error(`ANIMATED_DECK_VALIDATION_FAILED: ${validation.errors.join(" | ")}`);
  }

  return {
    animatedSlideCount,
    cleanup,
    css,
    deck: {
      height: ANIMATED_DECK_HEIGHT,
      schemaVersion: ANIMATED_DECK_SCHEMA_VERSION,
      slides: preparedSlides,
      width: ANIMATED_DECK_WIDTH,
    },
    fonts,
    remoteAssets: options.remoteAssets || [],
    staticSlideCount: preparedSlides.length - animatedSlideCount,
    validation,
  };
}

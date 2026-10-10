import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { list, type Root } from "postcss";
import { HtmlEditingValidationError } from "./html-editing-validation";
import { readHtmlEditingSvgViewportBudget } from "./html-editing-svg-viewport.server";

type Stylesheet = Readonly<{root: Root; inlineElement?: Element}>;
type Budget = Readonly<{scale: number; translation: number}>;
const pixel = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)px$/i;
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export const HTML_EDITING_SVG_CSS_VIEWPORT_POLICY = Object.freeze({maximumSubjectChecks: 65_536,
  maximumSelectorCharacters: 2_000_000, maximumSelectorDepth: 16});

/** Conservative subject matching. Ancestors outside the isolated fragment may
 * satisfy source selectors, so matching only the full selector would undercount.
 * Complex subjects are included rather than evaluated as permission. No browser
 * cascade winner, conditional branch, layer or !important can recover budget. */
function possibleSubject(selector: string, element: Element, consume: (characters: number) => void, recursion = 0): boolean {
  consume(selector.length);
  if (recursion > HTML_EDITING_SVG_CSS_VIEWPORT_POLICY.maximumSelectorDepth) throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
  let depth = 0, bracket = 0, quote = "", start = 0;
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index];
    if (quote) {if (char === quote) quote = ""; continue;}
    if (char === "'" || char === '"') {quote = char; continue;}
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "[") bracket++;
    else if (char === "]") bracket--;
    else if (!depth && !bracket && /[\s>+~]/.test(char)) start = index + 1;
  }
  const subject = selector.slice(start).trim();
  // Pseudo-element dimensions do not size the SVG viewport itself.
  if (/::(?:before|after|first-line|first-letter|marker)$|:(?:before|after)$/.test(subject)) return false;
  const union = /^:(?:is|where)\(([\s\S]*)\)$/.exec(subject);
  if (union) return list.comma(union[1]).some(branch => possibleSubject(branch, element, consume, recursion + 1));
  const tag = /^[a-z][\w-]*(?=[.#:\[]|$)/i.exec(subject)?.[0];
  if (tag && tag.toLowerCase() !== element.name.toLowerCase()) return false;
  if (!/^(?:[a-z][\w-]*|\*)?(?:[.#][\w-]+)*$/i.test(subject)) return true;
  const classes = new Set((element.attribs.class ?? "").split(/\s+/));
  for (const token of subject.matchAll(/([.#])([\w-]+)/g))
    if (token[1] === "#" ? element.attribs.id !== token[2] : !classes.has(token[2])) return false;
  return true;
}

export type HtmlEditingSvgCssViewportEvidence = Readonly<{fixedBudget: Budget | null; requiresComputedAuthority: boolean}>;
const propertyName = (property: string) => property.replace(/\/\*[\s\S]*?\*\//g, "").toLowerCase().replace(/^-(?:webkit|moz)-/, "");
/** Checks every fixed CSS alternative, never claiming an attribute-only proof
 * covers relative/intrinsic/logical sizing. Those remain explicit unproven
 * evidence, not an identity transform or computed-layout/raster guarantee.
 * No source rewriting, winning declarations, media/layer or cancellation credit. */
export function createHtmlEditingSvgCssViewportReader(fragment: CheerioAPI, sheets: readonly Stylesheet[]) {
  const svgElements = fragment("svg").toArray(), overrides = new Map<Element, Map<string, number[]>>();
  const unproven = new Set<Element>(); let subjectChecks = 0, selectorCharacters = 0;
  const consumeSubject = (characters: number) => {
    selectorCharacters += characters;
    if (++subjectChecks > HTML_EDITING_SVG_CSS_VIEWPORT_POLICY.maximumSubjectChecks
      || selectorCharacters > HTML_EDITING_SVG_CSS_VIEWPORT_POLICY.maximumSelectorCharacters)
      throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
  };
  for (const sheet of sheets) sheet.root.walkRules(rule => {
    const declarations = (rule.nodes ?? []).filter(node => node.type === "decl"
      && /^(?:width|height|x|y|min-(?:width|height)|(?:min-|max-)?(?:inline-size|block-size)|all)$/.test(propertyName(node.prop)));
    if (!declarations.length) return;
    for (const element of svgElements) {
      if (sheet.inlineElement && sheet.inlineElement !== element) continue;
      if (!sheet.inlineElement && !rule.selectors.some(selector => possibleSubject(selector.replace(/\/\*[\s\S]*?\*\//g, ""), element, consumeSubject))) continue;
      const dimensions = overrides.get(element) ?? new Map<string, number[]>(); overrides.set(element, dimensions);
      for (const declaration of declarations) {
        if (declaration.type !== "decl") continue;
        const property = propertyName(declaration.prop), value = declaration.value.replace(/\/\*[\s\S]*?\*\//g, "").trim();
        const normalized = property.replace(/^min-/, ""), match = pixel.exec(value);
        const amount = match ? Number(match[1]) : value === "0" ? 0
          : ["x", "y"].includes(property) && numeric.test(value) ? Number(value) : null;
        if (!["width", "height", "x", "y"].includes(normalized) || amount === null || !Number.isFinite(amount)) {unproven.add(element); continue;}
        const candidates = dimensions.get(normalized) ?? []; candidates.push(amount); dimensions.set(normalized, candidates);
      }
    }
  });
  return (element: Element): HtmlEditingSvgCssViewportEvidence | undefined => {
    const dimensions = overrides.get(element); if (!dimensions) return undefined;
    const attributes = {...element.attribs};
    const readPixels = (name: string, fallback?: string) => {
      const raw = attributes[name] ?? fallback; if (raw === undefined) return null;
      const parsed = pixel.exec(raw.trim()); return parsed ? Number(parsed[1]) : numeric.test(raw.trim()) ? Number(raw) : null;
    };
    const attributeWidth = readPixels("width"), attributeHeight = readPixels("height");
    const width = attributeWidth ?? (dimensions.has("width") ? Math.max(...dimensions.get("width")!) : null);
    const height = attributeHeight ?? (dimensions.has("height") ? Math.max(...dimensions.get("height")!) : null);
    const x = readPixels("x", "0"), y = readPixels("y", "0");
    if ([width,height,x,y].some(value => value === null)) return {fixedBudget: null, requiresComputedAuthority: true};
    const maximum = (name: string, base: number) => Math.max(base, ...(dimensions.get(name) ?? []));
    const maximumWidth = maximum("width", width!), maximumHeight = maximum("height", height!);
    const requiresComputedAuthority = unproven.has(element) || attributeWidth === null || attributeHeight === null;
    if (maximumWidth === 0 || maximumHeight === 0) return {fixedBudget: {scale: 1, translation: 0}, requiresComputedAuthority};
    // Keep both signs of authored viewport origins; cancellation is not credit.
    const xs = [x!, ...(dimensions.get("x") ?? [])], ys = [y!, ...(dimensions.get("y") ?? [])];
    const budget = readHtmlEditingSvgViewportBudget({...attributes, width: String(maximumWidth), height: String(maximumHeight), x: "0", y: "0"});
    if (!budget) return {fixedBudget: null, requiresComputedAuthority: true};
    const [minX,minY,boxWidth,boxHeight] = (attributes.viewBox ?? attributes.viewbox).trim().split(/[\s,]+/).map(Number);
    const alignment = attributes.preserveAspectRatio ?? attributes.preserveaspectratio ?? "xMidYMid meet";
    const alignedExtent = (viewport: number, box: number) => /slice\s*$/.test(alignment) ? box * budget.scale : viewport;
    const factorX = alignment.includes("xMid") ? .5 : alignment.includes("xMax") ? 1 : 0;
    const factorY = alignment.includes("YMid") ? .5 : alignment.includes("YMax") ? 1 : 0;
    // Componentwise triangle bounds cover mixed cascade alternatives and all
    // alignment branches, including cancellation at maximum-width/height corner.
    const translationX = Math.max(...xs.map(Math.abs)) + Math.abs(minX) * budget.scale + factorX * alignedExtent(maximumWidth, boxWidth);
    const translationY = Math.max(...ys.map(Math.abs)) + Math.abs(minY) * budget.scale + factorY * alignedExtent(maximumHeight, boxHeight);
    return {fixedBudget: {scale: budget.scale, translation: Math.hypot(translationX, translationY)}, requiresComputedAuthority};
  };
}

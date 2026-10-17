import { HtmlEditingValidationError } from "./html-editing-validation";
import { assertHtmlEditingSvgPath } from "./html-editing-svg-path.server";
import { readHtmlEditingSvgViewportBudget } from "./html-editing-svg-viewport.server";
import { assertHtmlEditingLayoutExpansion } from "./html-editing-layout-expansion.server";
import { HTML_EDITING_GEOMETRY_POLICY } from "./html-editing-geometry-policy";
export { HTML_EDITING_GEOMETRY_POLICY } from "./html-editing-geometry-policy";

/** Bounds for imported static geometry, not a computed-layout guarantee. Canvas
 * dimensions are independently bounded by the native document schema. CSS math,
 * custom-property indirection and viewport-dependent units cannot establish a
 * static bound here and are rejected for the properties below, not clamped. */
const numberPattern = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const lengthPattern = new RegExp(`^(${numberPattern})(px|%|em|rem)?$`, "i");
const svgNumberPattern = new RegExp(`^${numberPattern}$`);
const lengthProperties = /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|top|right|bottom|left|inset(?:-(?:inline|block)(?:-(?:start|end))?)?|margin(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|padding(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|(?:row-|column-)?gap|font-size|letter-spacing|word-spacing|border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?-width|outline-(?:width|offset)|border(?:-(?:top-left|top-right|bottom-left|bottom-right|start-start|start-end|end-start|end-end))?-radius)$/;
const nonnegativeProperties = /(?:width|height|size|padding|gap|radius)$/;
const intrinsicLengths = new Set(["auto", "min-content", "max-content", "fit-content"]);
const borderLineStyles = new Set(["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"]);
const indirectBorderKeywords = new Set(["thin", "medium", "thick", "inherit", "initial", "unset", "revert", "revert-layer"]);
const svgTags = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan",
  "defs", "clippath", "mask", "lineargradient", "radialgradient", "stop"]);

function reject(): never { throw new HtmlEditingValidationError("INVALID_SOURCE"); }

export function assertHtmlEditingGeometryDeclaration(property: string, rawValue: string): void {
  const name = property.toLowerCase().replace(/^-(?:webkit|moz)-/, "");
  const value = rawValue.replace(/\/\*[\s\S]*?\*\//g, "").trim().toLowerCase();
  if (name === "column-rule-width") {
    assertHtmlEditingGeometryDeclaration("border-width", value);
    return;
  }
  if (name === "column-rule") { assertBoundedBorderShorthand(value); return; }
  if (["grid-gap", "grid-row-gap", "grid-column-gap"].includes(name)) {
    assertHtmlEditingGeometryDeclaration(name.replace(/^grid-/, ""), value);
    return;
  }
  if (assertHtmlEditingLayoutExpansion(name, value, length => assertHtmlEditingGeometryDeclaration("width", length))) return;
  if (/^(?:-(?:webkit|moz)-)?(?:offset|motion)(?:-|$)/.test(name)) {
    // Motion-path applies an additional transform even with transform:none.
    // Keep only inert initial spellings; native motion remains authoritative.
    const normalized = name.replace(/^-(?:webkit|moz)-/, "").replace(/^motion/, "offset");
    const initial = normalized === "offset" || normalized === "offset-path" ? ["none"]
      : normalized === "offset-distance" ? ["0", "0px", "0%"]
        : normalized === "offset-position" ? ["normal"]
          : normalized === "offset-anchor" ? ["auto"]
            : normalized === "offset-rotate" ? ["auto", "0deg"] : [];
    if (!initial.includes(value)) reject();
    return;
  }
  if (/^(?:border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|outline)$/.test(name)) {
    assertBoundedBorderShorthand(value);
    return;
  }
  if (["x", "y", "cx", "cy", "r", "rx", "ry", "stroke-width", "stroke-dashoffset"].includes(name)) {
    if (value === "auto" && ["rx", "ry"].includes(name)) return;
    if (!lengthPattern.test(value)) reject();
    const normalized = svgNumberPattern.test(value) ? `${value}px` : value;
    assertHtmlEditingGeometryDeclaration(["r", "rx", "ry", "stroke-width"].includes(name) ? "border-width" : "left", normalized);
    return;
  }
  if (name === "stroke-dasharray") {
    if (value === "none") return;
    if (!value || /(?:^|,)\s*,|,\s*$/.test(value)) reject();
    const lengths = value.split(/[\s,]+/);
    if (lengths.length > HTML_EDITING_GEOMETRY_POLICY.maximumSvgDashValues) reject();
    for (const length of lengths) assertHtmlEditingGeometryDeclaration("stroke-width", length);
    return;
  }
  if (name === "stroke-miterlimit") {
    const amount = Number(value);
    if (!svgNumberPattern.test(value) || !Number.isFinite(amount) || amount < 1
      || amount > HTML_EDITING_GEOMETRY_POLICY.maximumStrokeMiterLimit) reject();
    return;
  }
  // CSS d can override a validated SVG attribute, including through selectors.
  // Only the attribute grammar is admitted; never let CSS replace its geometry.
  if (name === "d") {
    if (value !== "none") reject();
    return;
  }
  if (/^(?:-(?:webkit|moz)-)?filter$/.test(name)) {
    // Local SVG filter refs remain subject to the resource policy; imported
    // filter primitive tags are independently excluded by the static compiler.
    if (value === "none" || /^url\(\s*["']?#[a-zA-Z_][\w.-]*["']?\s*\)$/.test(value)) return;
    const blur = /^blur\(([\d.]+)px\)$/.exec(value);
    if (!blur || !Number.isFinite(Number(blur[1])) || Number(blur[1]) > HTML_EDITING_GEOMETRY_POLICY.maximumEffectPixels) reject();
    return;
  }
  if (["box-shadow", "text-shadow"].includes(name)) {
    if (value !== "none") reject(); // Typed bounded effects need a dedicated adapter.
    return;
  }
  if (name === "position") {
    if (!["static", "relative", "absolute"].includes(value)) reject();
    return;
  }
  // Relative font sizes amplify across nested nodes even if every individual
  // token is small. Require a pixel bound and longhands for font geometry.
  if (name === "font") reject();
  if (name === "line-height") {
    const match = lengthPattern.exec(value);
    if (!match) reject();
    const amount = Number(match[1]);
    const unit = match[2] ?? "";
    if (!Number.isFinite(amount) || amount < 0
      || (unit === "" ? amount > HTML_EDITING_GEOMETRY_POLICY.maximumLineHeight
        : unit !== "px" || amount > HTML_EDITING_GEOMETRY_POLICY.maximumFontPixels * HTML_EDITING_GEOMETRY_POLICY.maximumLineHeight)) reject();
    return;
  }
  // Backdrops sample neighbouring clips; CSS-owned transforms/perspective can
  // escape a finite authored box. Motion remains in the native evaluator.
  if (/^(?:-(?:webkit|moz)-)?(?:backdrop-filter|perspective|transform|translate|rotate|scale|zoom)$/.test(name)) {
    if (value !== "none" && !(name === "zoom" && value === "1")) reject();
    return;
  }
  if (!lengthProperties.test(name)) return;
  // Slash-separated radii and the usual 1–4-value shorthands remain supported.
  // No functions/escapes/global cascade keywords: these need computed authority.
  if (/[\\()]/.test(value)) reject();
  const groups = value.split("/");
  if (groups.length > (name.endsWith("radius") ? 2 : 1)) reject();
  for (const group of groups) {
    const lengths = group.trim().split(/\s+/);
    if (lengths.length > 4) reject();
    for (const length of lengths) {
      if (intrinsicLengths.has(length)) {
        if (!/^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|margin(?:-|$)|(?:top|right|bottom|left)$|inset(?:-|$))/.test(name)) reject();
        continue;
      }
      if (length === "none" && name.startsWith("max-")) continue;
      const match = lengthPattern.exec(length);
      if (!match) reject();
      const amount = Number(match[1]);
      const unit = (match[2] ?? "").toLowerCase();
      if (!Number.isFinite(amount) || (!unit && amount !== 0) || (nonnegativeProperties.test(name) && amount < 0)) reject();
      if (name === "font-size" && unit !== "px" && amount !== 0) reject();
      const limit = unit === "%" ? HTML_EDITING_GEOMETRY_POLICY.maximumPercent
        : unit === "em" || unit === "rem" ? HTML_EDITING_GEOMETRY_POLICY.maximumRelativeLength
        : name === "font-size" ? HTML_EDITING_GEOMETRY_POLICY.maximumFontPixels : HTML_EDITING_GEOMETRY_POLICY.maximumPixels;
      if (Math.abs(amount) > limit) reject();
    }
  }
}

/** Closed shorthand subset: explicit pixel width, optional line style/color.
 * Functions/variables could expand into width tokens, so require longhands for
 * those declarations. Never strip a shorthand or let it bypass width admission. */
function assertBoundedBorderShorthand(value: string): void {
  if (value === "none" || value === "hidden") return;
  const tokens = value.split(/\s+/);
  if (!value || /[\\()]/.test(value) || tokens.length > 3) reject();
  let widths = 0, lineStyles = 0, colors = 0;
  for (const token of tokens) {
    if (lengthPattern.test(token)) {
      const match = lengthPattern.exec(token)!;
      if (Number(match[1]) !== 0 && (match[2] ?? "").toLowerCase() !== "px") reject();
      assertHtmlEditingGeometryDeclaration("border-width", token);
      widths++;
    } else if (borderLineStyles.has(token)) lineStyles++;
    else if (/^(?:#(?:[a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})|[a-z]+)$/.test(token) && !indirectBorderKeywords.has(token)) colors++;
    else reject();
  }
  if (widths !== 1 || lineStyles > 1 || colors > 1) reject();
}

/** SVG dimensions are independent of CSS declarations. ViewBox is finite and
 * positive in size; unit-bearing dimensions use the same static length policy.
 * Path complexity and complete raster allocation remain separate concerns. */
export function assertHtmlEditingSvgGeometry(tag: string, attributes: Readonly<Record<string, string>>): void {
  if (!svgTags.has(tag)) return;
  if (tag === "svg") readHtmlEditingSvgViewportBudget(attributes);
  for (const [name, raw] of Object.entries(attributes)) {
    const attribute = name.toLowerCase();
    if (["transform", "gradienttransform", "patterntransform"].includes(attribute)) {
      assertSvgTransform(raw);
    } else if (attribute === "d") {
      assertHtmlEditingSvgPath(raw, { maximumMagnitude: HTML_EDITING_GEOMETRY_POLICY.maximumSvgMagnitude,
        maximumNumericTokens: HTML_EDITING_GEOMETRY_POLICY.maximumSvgNumericTokens });
    } else if (attribute === "points") {
      assertSvgNumericBudget(raw);
    } else if (["stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit"].includes(attribute)) {
      assertHtmlEditingGeometryDeclaration(attribute, raw);
    } else if (attribute === "filter") {
      assertHtmlEditingGeometryDeclaration(attribute, raw);
    } else if (["stroke-width", "font-size", "letter-spacing", "word-spacing"].includes(attribute)) {
      const value = svgNumberPattern.test(raw.trim()) ? `${raw.trim()}px` : raw;
      assertHtmlEditingGeometryDeclaration(attribute === "stroke-width" ? "border-width" : attribute, value);
    } else if (attribute === "viewbox") {
      const parts = raw.trim().split(/[\s,]+/);
      if (parts.length !== 4 || parts.some(part => !svgNumberPattern.test(part))) reject();
      const values = parts.map(Number);
      if (values.some(value => !Number.isFinite(value) || Math.abs(value) > HTML_EDITING_GEOMETRY_POLICY.maximumSvgMagnitude)
        || values[2] <= 0 || values[3] <= 0) reject();
    } else if (["x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "width", "height"].includes(name)) {
      // SVG permits unitless user coordinates. Convert that spelling only for
      // validation, retaining the original attribute byte-for-byte in the DOM.
      const value = svgNumberPattern.test(raw.trim()) ? `${raw.trim()}px` : raw;
      assertHtmlEditingGeometryDeclaration(["width", "height"].includes(name) ? name : "left", value);
      if (["r", "rx", "ry"].includes(name) && Number.parseFloat(raw) < 0) reject();
    }
  }
}

function assertSvgNumericBudget(value: string): void {
  const matches = value.matchAll(new RegExp(numberPattern, "g"));
  let count = 0;
  for (const match of matches) {
    const amount = Number(match[0]);
    if (++count > HTML_EDITING_GEOMETRY_POLICY.maximumSvgNumericTokens
      || !Number.isFinite(amount) || Math.abs(amount) > HTML_EDITING_GEOMETRY_POLICY.maximumSvgMagnitude) reject();
  }
  if (/\b(?:nan|infinity)\b/i.test(value)) reject();
}

export type HtmlEditingSvgTransformBudget = Readonly<{ scale: number; translation: number }>;
export const HTML_EDITING_SVG_IDENTITY_BUDGET: HtmlEditingSvgTransformBudget = Object.freeze({ scale: 1, translation: 0 });

/** Conservative operator-norm envelope, not a browser matrix approximation.
 * Rotation has norm1; rotation about a centre translates by at most twice its
 * radius. Never subtract cancelling transforms or use shrinking descendants
 * to recover an exhausted ancestor budget. */
export function composeHtmlEditingSvgTransformBudget(parent: HtmlEditingSvgTransformBudget,
  local: HtmlEditingSvgTransformBudget): HtmlEditingSvgTransformBudget {
  const scale = parent.scale * local.scale;
  const translation = parent.translation + parent.scale * local.translation;
  if (!Number.isFinite(scale) || !Number.isFinite(translation)
    || scale > HTML_EDITING_GEOMETRY_POLICY.maximumSvgScale
    || translation > HTML_EDITING_GEOMETRY_POLICY.maximumSvgMagnitude) reject();
  return { scale, translation };
}

export function readHtmlEditingSvgTransformBudget(tag: string, attributes: Readonly<Record<string, string>>,
  parent: HtmlEditingSvgTransformBudget, cssViewport?: HtmlEditingSvgTransformBudget | null): HtmlEditingSvgTransformBudget {
  if (!svgTags.has(tag)) return parent;
  const local = attributes.transform === undefined ? HTML_EDITING_SVG_IDENTITY_BUDGET : assertSvgTransform(attributes.transform);
  let accumulated = composeHtmlEditingSvgTransformBudget(parent, local);
  if (tag === "svg") {
    const authored = readHtmlEditingSvgViewportBudget(attributes);
    const viewport = cssViewport ? {scale: Math.max(authored?.scale ?? 1, cssViewport.scale),
      translation: Math.max(authored?.translation ?? 0, cssViewport.translation)} : authored;
    // null retains the existing authored-transform envelope, not a claim that
    // CSS/percentage/missing dimensions establish a bounded viewport mapping.
    if (viewport) accumulated = composeHtmlEditingSvgTransformBudget(accumulated, viewport);
  }
  // Gradient transforms affect sampling, not descendant coordinates. Validate
  // against the accumulated envelope but do not propagate them to siblings.
  for (const name of ["gradientTransform", "gradienttransform", "patternTransform", "patterntransform"])
    if (attributes[name] !== undefined) composeHtmlEditingSvgTransformBudget(accumulated, assertSvgTransform(attributes[name]));
  return accumulated;
}

function assertSvgTransform(value: string): HtmlEditingSvgTransformBudget {
  const transformations = [...value.matchAll(/([a-zA-Z]+)\s*\(([^()]*)\)/g)];
  if (!transformations.length || transformations.length > HTML_EDITING_GEOMETRY_POLICY.maximumSvgTransforms) reject();
  let remaining = value;
  let budget = HTML_EDITING_SVG_IDENTITY_BUDGET;
  for (const match of transformations) {
    remaining = remaining.replace(match[0], "");
    const kind = match[1];
    const tokens = match[2].trim().split(/[\s,]+/);
    if (tokens.some(token => !svgNumberPattern.test(token))) reject();
    const amounts = tokens.map(Number);
    if (amounts.some(amount => !Number.isFinite(amount))) reject();
    // General affine/skew matrices require composite bounds; retain bounded
    // translate/rotate/scale syntax, including the existing donut chart renderer.
    if (kind === "translate" && [1, 2].includes(amounts.length)) {
      if (amounts.some(amount => Math.abs(amount) > HTML_EDITING_GEOMETRY_POLICY.maximumSvgMagnitude)) reject();
      budget = composeHtmlEditingSvgTransformBudget(budget, { scale: 1, translation: Math.hypot(amounts[0], amounts[1] ?? 0) });
    } else if (kind === "scale" && [1, 2].includes(amounts.length)) {
      if (amounts.some(amount => Math.abs(amount) > HTML_EDITING_GEOMETRY_POLICY.maximumSvgScale)) reject();
      budget = composeHtmlEditingSvgTransformBudget(budget, { scale: Math.max(1, ...amounts.map(Math.abs)), translation: 0 });
    } else if (kind === "rotate" && [1, 3].includes(amounts.length)) {
      if (Math.abs(amounts[0]) > 360 || amounts.slice(1).some(amount => Math.abs(amount) > HTML_EDITING_GEOMETRY_POLICY.maximumSvgMagnitude)) reject();
      budget = composeHtmlEditingSvgTransformBudget(budget, { scale: 1,
        translation: amounts.length === 3 ? 2 * Math.hypot(amounts[1], amounts[2]) : 0 });
    } else reject();
  }
  if (remaining.replace(/[\s,]+/g, "")) reject();
  return budget;
}

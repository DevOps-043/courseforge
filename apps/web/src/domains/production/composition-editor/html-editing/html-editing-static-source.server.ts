import { load, type CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import postcss, { type ChildNode } from "postcss";
import { HTML_EDITING_LIMITS } from "./html-editing.contract";
import { HtmlEditingValidationError } from "./html-editing-validation";
import { assertHtmlEditingGeometryDeclaration, assertHtmlEditingSvgGeometry, readHtmlEditingSvgTransformBudget,
  HTML_EDITING_SVG_IDENTITY_BUDGET, type HtmlEditingSvgTransformBudget } from "./html-editing-geometry.server";
import { createHtmlEditingSvgCssViewportReader } from "./html-editing-svg-css-viewport.server";

const staticAtRules = new Set(["media", "supports", "layer"]);
const autonomousProperties = /^(?:-(?:webkit|moz|o)-)?(?:animation|transition)(?:-|$)/i;
const interactiveSelector = /:(?:hover|active|focus(?:-visible|-within)?|visited|target|checked|indeterminate)\b/i;
const userEnvironmentCondition = /\b(?:prefers-[\w-]+|(?:any-)?hover|(?:any-)?pointer|light-level|scripting|display-mode|forced-colors|inverted-colors|(?:video-)?dynamic-range)\s*:/i;

function assertStaticCss(css: string, budget: { bytes: number; nodes: number }) {
  budget.bytes += Buffer.byteLength(css, "utf8");
  if (budget.bytes > HTML_EDITING_LIMITS.cssBytes) throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
  let root: ReturnType<typeof postcss.parse>;
  try { root = postcss.parse(css); }
  catch { throw new HtmlEditingValidationError("INVALID_SOURCE"); }
  const pending: Array<{ node: ChildNode; depth: number }> = (root.nodes ?? []).map(node => ({ node, depth: 1 }));
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++budget.nodes > HTML_EDITING_LIMITS.cssNodes || depth > HTML_EDITING_LIMITS.cssDepth)
      throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
    if (node.type === "atrule" && !staticAtRules.has(node.name.toLowerCase()))
      throw new HtmlEditingValidationError("INVALID_SOURCE");
    if (node.type === "atrule") {
      const condition = node.params.replace(/\/\*[\s\S]*?\*\//g, "");
      if (condition.includes("\\") || userEnvironmentCondition.test(condition)) throw new HtmlEditingValidationError("INVALID_SOURCE");
    }
    if (node.type === "decl") {
      const property = node.prop.replace(/\/\*[\s\S]*?\*\//g, "");
      if (property.includes("\\") || autonomousProperties.test(property)) throw new HtmlEditingValidationError("INVALID_SOURCE");
      assertHtmlEditingGeometryDeclaration(property, node.value);
    }
    if (node.type === "rule") {
      const selector = node.selector.replace(/\/\*[\s\S]*?\*\//g, "");
      if (selector.includes("\\") || interactiveSelector.test(selector)) throw new HtmlEditingValidationError("INVALID_SOURCE");
    }
    if ("nodes" in node && node.nodes) for (const child of node.nodes) pending.push({ node: child, depth: depth + 1 });
  }
  return root;
}

/** CAP-029 static adapter admission, not a browser sandbox. Check complexity
 * before recursive DOM selectors/resource walkers. Source remains immutable:
 * unsupported temporal/interactive CSS is rejected, never silently stripped.
 * Runtime motion belongs to the native evaluator, not imported CSS clocks. */
export function parseHtmlEditingStaticSource(sourceHtml: string, contextualCss?: string): CheerioAPI {
  if (typeof sourceHtml !== "string") throw new HtmlEditingValidationError("INVALID_SOURCE");
  if (sourceHtml.length > HTML_EDITING_LIMITS.sourceBytes || Buffer.byteLength(sourceHtml, "utf8") > HTML_EDITING_LIMITS.sourceBytes)
    throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
  let fragment: CheerioAPI;
  try { fragment = load(sourceHtml, {}, false); }
  catch { throw new HtmlEditingValidationError("INVALID_SOURCE"); }
  const pending: Array<{ node: AnyNode; depth: number; transform: HtmlEditingSvgTransformBudget }> = fragment.root().contents().toArray()
    .map(node => ({ node, depth: 1, transform: HTML_EDITING_SVG_IDENTITY_BUDGET }));
  let nodes = 0, elements = 0;
  const cssBudget = { bytes: 0, nodes: 0 };
  const stylesheets: Array<{root: ReturnType<typeof assertStaticCss>; inlineElement?: Element}> = [];
  const sourceElements: Element[] = [];
  // One combined CSS budget: an external deck stylesheet must not bypass the
  // fragment's static geometry/clock/resource-independent complexity admission.
  if (contextualCss !== undefined) {
    if (typeof contextualCss !== "string") throw new HtmlEditingValidationError("INVALID_SOURCE");
    stylesheets.push({root: assertStaticCss(contextualCss, cssBudget)});
  }
  while (pending.length) {
    const { node, depth, transform } = pending.pop()!;
    let descendantTransform = transform;
    if (++nodes > HTML_EDITING_LIMITS.sourceNodes || depth > HTML_EDITING_LIMITS.sourceDepth)
      throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
    if (node.type === "tag" || node.type === "style" || node.type === "script") {
      sourceElements.push(node);
      if (++elements > HTML_EDITING_LIMITS.sourceElements) throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
      assertHtmlEditingSvgGeometry(node.name.toLowerCase(), node.attribs);
      descendantTransform = readHtmlEditingSvgTransformBudget(node.name.toLowerCase(), node.attribs, transform);
      if (node.attribs.style !== undefined) stylesheets.push({root: assertStaticCss(`.editable {${node.attribs.style}}`, cssBudget), inlineElement: node});
      if (node.name.toLowerCase() === "style") {
        // CSS style nodes must contain text only, no nesting requiring recursion.
        if (node.children.some(child => child.type !== "text")) throw new HtmlEditingValidationError("INVALID_SOURCE");
        stylesheets.push({root: assertStaticCss(node.children.map(child => child.type === "text" ? child.data : "").join(""), cssBudget)});
      }
    }
    if ("children" in node) for (const child of node.children) pending.push({ node: child, depth: depth + 1, transform: descendantTransform });
  }
  // Only after complete DOM/CSS complexity admission: later styles and contextual
  // sheets can size earlier SVG nodes. A second preorder pass includes CSS changes
  // in ancestor envelopes, not just a per-node check against authored attributes.
  const viewportEvidence = createHtmlEditingSvgCssViewportReader(fragment, stylesheets);
  const accumulated = new Map<AnyNode, HtmlEditingSvgTransformBudget>();
  for (const element of sourceElements) {
    const parent = element.parent ? accumulated.get(element.parent) : undefined;
    const evidence = element.name.toLowerCase() === "svg" ? viewportEvidence(element) : undefined;
    accumulated.set(element, readHtmlEditingSvgTransformBudget(element.name.toLowerCase(), element.attribs,
      parent ?? HTML_EDITING_SVG_IDENTITY_BUDGET, evidence?.fixedBudget));
  }
  return fragment;
}

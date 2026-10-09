import { createHash } from "node:crypto";
import type { Element } from "domhandler";
import {
  HTML_EDITING_LIMITS, htmlEditingOverrideStateSchema, type HtmlEditingBinding,
} from "./html-editing.contract";
import {
  decodeHtmlEditingBoundedJson, htmlEditingBindingsMatch, HtmlEditingValidationError, validateHtmlEditingCommand,
  validateHtmlEditingAttributeValue,
} from "./html-editing-validation";
import { verifyHtmlEditableManifestContent } from "./html-editing-manifest-digest.server";
import { createLocalHtmlResourceValidator } from "./html-local-resource-policy.server";
import { parseHtmlEditingStaticSource } from "./html-editing-static-source.server";
import { readHtmlEditingVisibilityDefault, applyHtmlEditingVisibility } from "./html-editing-visibility.server";
import { readHtmlEditingSlotDefaults, applyHtmlEditingSlotOrder } from "./html-editing-slots.server";
import { readHtmlEditingChartDefault, renderHtmlEditingChart } from "./html-editing-chart.server";
import { readHtmlEditingStyleRangeDefault, applyHtmlEditingStyleRange } from "./html-editing-style-range.server";
import { readHtmlEditingTextLocaleDefault } from "./html-editing-text-locale.server";
import { HTML_EDITING_SCOPE_ATTRIBUTE, isolateHtmlEditingFragment } from "./html-editing-isolation.server";

const staticTags = new Set([
  "div", "section", "article", "main", "header", "footer", "aside", "p", "span", "strong", "em", "b", "i",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "figure", "figcaption", "img", "style",
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan",
  "defs", "clippath", "mask", "lineargradient", "radialgradient", "stop", "title", "desc",
]);
const editableAttribute = "data-courseforge-editable-id";
const themeTokenAttribute = "data-courseforge-theme-token";
const themeChoiceAttribute = "data-courseforge-theme-choice";
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest = (source: string) => createHash("sha256").update(source, "utf8").digest("hex");

function assertTextBudget(value: string, maxBytes: number): void {
  if (typeof value !== "string") throw new HtmlEditingValidationError("INVALID_SOURCE");
  if (value.length > maxBytes || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
  }
}

function assertLocalResources(html: string, localFiles: ReadonlySet<string>): ReadonlySet<string> {
  try {
    const validator = createLocalHtmlResourceValidator({ remoteToLocal: new Map(), localFiles });
    validator.assertFragment(html);
    return validator.referencedLocalFiles;
  }
  catch { throw new HtmlEditingValidationError("INVALID_SOURCE"); }
}

/** Pure experimental static-fragment adapter. Callers must independently authorize
 * binding, source and materialized image grants. No live route/UI activation,
 * browser sandbox, asset MIME attestation or pixel parity is implied. */
export function compileHtmlEditingFragment(params: {
  sourceHtml: string; encodedManifest: string; encodedState: string;
  authoritativeBinding: HtmlEditingBinding; grantedAssetIds: readonly string[];
  imageSources: ReadonlyMap<string, string>;
}): { html: string; sourceSha256: string; compiledSha256: string; instrumentedElementIds: string[]; usedAssetIds: string[] } {
  assertTextBudget(params.sourceHtml, HTML_EDITING_LIMITS.sourceBytes);
  const manifest = verifyHtmlEditableManifestContent(params.encodedManifest, params.authoritativeBinding);
  const sourceSha256 = digest(params.sourceHtml);
  if (sourceSha256 !== manifest.binding.sourceSha256) throw new HtmlEditingValidationError("SOURCE_DIGEST_MISMATCH");
  const parsed = htmlEditingOverrideStateSchema.safeParse(decodeHtmlEditingBoundedJson(params.encodedState, HTML_EDITING_LIMITS.stateBytes));
  if (!parsed.success) throw new HtmlEditingValidationError("INVALID_OVERRIDE_STATE");
  if (!htmlEditingBindingsMatch(parsed.data.binding, manifest.binding)) throw new HtmlEditingValidationError("STALE_BINDING");
  for (const override of parsed.data.overrides) {
    validateHtmlEditingCommand({ encodedCommand: JSON.stringify({
      format: "courseforge-html-editable-command-v1", binding: manifest.binding, overrides: [override],
    }), manifest, verifiedBinding: manifest.binding, grantedAssetIds: params.grantedAssetIds });
  }
  // Exact materializer paths only; never accept a user URL or infer/decode paths.
  if (params.imageSources.size > HTML_EDITING_LIMITS.elements * HTML_EDITING_LIMITS.choices) {
    throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
  }
  const knownFiles = new Set<string>();
  const grantedFiles = new Set<string>();
  const grants = new Set(params.grantedAssetIds);
  for (const [assetId, path] of params.imageSources) {
    if (!uuidPattern.test(assetId) || path !== `conformance-media/${assetId}` || knownFiles.has(path)) {
      throw new HtmlEditingValidationError("ASSET_SOURCE_MISSING");
    }
    knownFiles.add(path);
    if (grants.has(assetId)) grantedFiles.add(path);
  }
  // Prior defaults may be revoked and replaced, but no revoked resource may
  // survive in the final output, including a default resurrected by RESET.
  const fragment = parseHtmlEditingStaticSource(params.sourceHtml);
  assertLocalResources(params.sourceHtml, knownFiles);
  const allElements = fragment("*");
  if (allElements.length > HTML_EDITING_LIMITS.sourceElements) throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
  const byId = new Map<string, Element>();
  const declaredIds = new Set(manifest.elements.map(element => element.targetElementId ?? element.elementId));
  allElements.each((_index, element) => {
    if (element.type !== "tag" && element.type !== "style" && element.type !== "script") throw new HtmlEditingValidationError("INVALID_SOURCE");
    if (!staticTags.has(element.name.toLowerCase())) throw new HtmlEditingValidationError("INVALID_SOURCE");
    const node = fragment(element);
    if (node.attr(HTML_EDITING_SCOPE_ATTRIBUTE) !== undefined) throw new HtmlEditingValidationError("INVALID_SOURCE");
    const id = node.attr("id");
    if (id !== undefined) {
      if (!id || byId.has(id)) throw new HtmlEditingValidationError("INVALID_SOURCE");
      byId.set(id, element);
    }
    const instrumentedId = node.attr(editableAttribute);
    if (instrumentedId !== undefined && (instrumentedId !== id || !declaredIds.has(instrumentedId))) {
      throw new HtmlEditingValidationError("INVALID_SOURCE");
    }
  });
  for (const declaration of manifest.elements) {
    const targetId = declaration.targetElementId ?? declaration.elementId;
    const element = byId.get(targetId);
    if (!element) throw new HtmlEditingValidationError("UNKNOWN_ELEMENT");
    const node = fragment(element);
    if (declaration.kind === "TEXT" && (node.children().length || ["style", "img"].includes(element.name.toLowerCase()))) {
      throw new HtmlEditingValidationError("INVALID_SOURCE");
    }
    if (declaration.kind === "IMAGE") {
      if (element.name.toLowerCase() !== "img") throw new HtmlEditingValidationError("INVALID_SOURCE");
      const defaultSource = node.attr("src");
      if (defaultSource !== undefined && !declaration.allowedAssetIds.some(assetId => params.imageSources.get(assetId) === defaultSource)) {
        throw new HtmlEditingValidationError("INVALID_SOURCE");
      }
    }
    if (declaration.kind === "THEME") {
      const token = node.attr(themeTokenAttribute);
      const choice = node.attr(themeChoiceAttribute);
      if ((token !== undefined && token !== declaration.tokenId)
        || (choice !== undefined && !declaration.allowedChoiceIds.includes(choice))) {
        throw new HtmlEditingValidationError("INVALID_SOURCE");
      }
    }
    if (declaration.kind === "ATTRIBUTE") {
      const original = node.attr(declaration.attributeName);
      if (original !== undefined) validateHtmlEditingAttributeValue(declaration, original);
    }
    if (declaration.kind === "VISIBILITY") readHtmlEditingVisibilityDefault(node, declaration);
    if (declaration.kind === "SLOTS") readHtmlEditingSlotDefaults(node, declaration);
    if (declaration.kind === "RANGE_TOKEN") readHtmlEditingStyleRangeDefault(node, declaration);
    if (declaration.kind === "TEXT") readHtmlEditingTextLocaleDefault(node, declaration);
    if (declaration.kind === "CHART") {
      readHtmlEditingChartDefault(node, declaration);
      if (node.find("*").toArray().some(child => child.attribs.id && declaredIds.has(child.attribs.id)))
        throw new HtmlEditingValidationError("INVALID_SOURCE");
    }
    node.attr(editableAttribute, targetId);
  }
  for (const override of parsed.data.overrides) {
    const field = manifest.elements.find(element => element.elementId === override.elementId)!;
    const node = fragment(byId.get(field.targetElementId ?? field.elementId)!);
    if (override.operation === "SET_TEXT") {
      node.text(override.value);
      if (override.locale) node.attr("lang", override.locale.language).attr("dir", override.locale.direction);
    }
    else if (override.operation === "SET_IMAGE") {
      const path = params.imageSources.get(override.assetId);
      if (!path) throw new HtmlEditingValidationError("ASSET_SOURCE_MISSING");
      node.attr("src", path).css("object-fit", override.fit.toLowerCase());
    } else if (override.operation === "SET_THEME") {
      node.attr(themeTokenAttribute, override.tokenId).attr(themeChoiceAttribute, override.choiceId);
    } else if (override.operation === "SET_ATTRIBUTE") {
      node.attr(override.attributeName, override.value);
    } else if (override.operation === "SET_VISIBILITY") {
      const declaration = manifest.elements.find(element => element.elementId === override.elementId);
      if (declaration?.kind !== "VISIBILITY") throw new HtmlEditingValidationError("PROPERTY_NOT_DECLARED");
      applyHtmlEditingVisibility(node, declaration, override.visible);
    } else if (override.operation === "SET_SLOT_ORDER") {
      const declaration = manifest.elements.find(element => element.elementId === override.elementId);
      if (declaration?.kind !== "SLOTS") throw new HtmlEditingValidationError("PROPERTY_NOT_DECLARED");
      applyHtmlEditingSlotOrder(node, declaration, override.itemIds);
    } else if (override.operation === "SET_CHART_DATA") {
      const declaration = manifest.elements.find(element => element.elementId === override.elementId);
      if (declaration?.kind !== "CHART") throw new HtmlEditingValidationError("PROPERTY_NOT_DECLARED");
      node.html(renderHtmlEditingChart(declaration, override.dataset));
    } else {
      const declaration = manifest.elements.find(element => element.elementId === override.elementId);
      if (declaration?.kind !== "RANGE_TOKEN") throw new HtmlEditingValidationError("PROPERTY_NOT_DECLARED");
      applyHtmlEditingStyleRange(node, declaration, override.value);
    }
  }
  const html = isolateHtmlEditingFragment(fragment, manifest.binding);
  assertTextBudget(html, HTML_EDITING_LIMITS.compiledBytes);
  // Typed generated content must obey the same aggregate DOM/CSS budgets as
  // imported source; many individually bounded charts can still exceed them.
  parseHtmlEditingStaticSource(html);
  const usedFiles = assertLocalResources(html, grantedFiles);
  const usedAssetIds = [...params.imageSources].filter(([, path]) => usedFiles.has(path)).map(([assetId]) => assetId).sort();
  return { html, sourceSha256, compiledSha256: digest(html), instrumentedElementIds: manifest.elements.map(element => element.elementId), usedAssetIds };
}

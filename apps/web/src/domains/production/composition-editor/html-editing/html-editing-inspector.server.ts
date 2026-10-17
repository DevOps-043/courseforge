import { load } from "cheerio";
import { htmlEditingInspectorViewSchema, HTML_EDITING_INSPECTOR_POLICY, type HtmlEditingInspectorView } from "./html-editing-inspector.contract";
import { verifyHtmlEditingRevision, type HtmlEditingRevisionAuthority } from "./html-editing-revision.server";
import { HtmlEditingRevisionError, htmlEditingRevisionSchema, HTML_EDITING_REVISION_POLICY } from "./html-editing-revision.contract";
import { htmlEditingBindingSchema } from "./html-editing.contract";
import { decodeHtmlEditingBoundedJson } from "./html-editing-validation";
import { readHtmlEditingVisibilityDefault } from "./html-editing-visibility.server";
import { readHtmlEditingSlotDefaults } from "./html-editing-slots.server";
import { readHtmlEditingChartDefault } from "./html-editing-chart.server";
import { readHtmlEditingStyleRangeDefault } from "./html-editing-style-range.server";
import { readHtmlEditingTextLocaleDefault } from "./html-editing-text-locale.server";

/** Integrity is checked using declared resources so revoked overrides remain
 * inspectable/removable. Current grants are projected separately, not bypassed.
 * No raw source/compiled HTML/URLs/paths/provider details leave this projection. */
export function createHtmlEditingInspectorView(input: HtmlEditingRevisionAuthority & {
  encodedRevision: string; compositionDocumentHash: string;
}): HtmlEditingInspectorView {
  const binding = htmlEditingBindingSchema.parse(input.authoritativeBinding);
  // First compilation validates source/declarations/state, independent of grants.
  // The durable repository must already have checked the independently stored SHA.
  const stored = htmlEditingRevisionSchema.safeParse(decodeHtmlEditingBoundedJson(input.encodedRevision, HTML_EDITING_REVISION_POLICY.maximumBytes));
  if (!stored.success) throw new HtmlEditingRevisionError("INVALID_REVISION");
  const declarationAuthority = { ...input, grantedAssetIds: [...new Set(stored.data.manifest.elements.flatMap(
    element => element.kind === "IMAGE" ? element.allowedAssetIds : []))] };
  const verified = verifyHtmlEditingRevision(declarationAuthority);
  const revision = verified.revision;
  const declaredAssets = new Set(revision.manifest.elements.flatMap(element => element.kind === "IMAGE" ? element.allowedAssetIds : []));
  if (input.grantedAssetIds.some(id => !declaredAssets.has(id))) throw new HtmlEditingRevisionError("INVALID_REVISION");
  const source = load(revision.sourceHtml, {}, false);
  const defaults: HtmlEditingInspectorView["defaults"] = revision.manifest.elements.map(element => {
    const node = source(`#${element.targetElementId ?? element.elementId}`);
    if (element.kind === "TEXT") {
      const locale = readHtmlEditingTextLocaleDefault(node, element);
      return { kind: "TEXT", elementId: element.elementId, value: node.text(), ...(locale ? { locale } : {}) };
    }
    if (element.kind === "THEME") return { kind: "THEME", elementId: element.elementId,
      choiceId: node.attr("data-courseforge-theme-choice") ?? null };
    if (element.kind === "ATTRIBUTE") return { kind: "ATTRIBUTE", elementId: element.elementId,
      attributeName: element.attributeName, value: node.attr(element.attributeName) ?? null };
    if (element.kind === "VISIBILITY") return { kind: "VISIBILITY", elementId: element.elementId,
      visible: readHtmlEditingVisibilityDefault(node, element) };
    if (element.kind === "SLOTS") return { kind: "SLOTS", elementId: element.elementId,
      itemIds: readHtmlEditingSlotDefaults(node, element) };
    if (element.kind === "CHART") return { kind: "CHART", elementId: element.elementId,
      dataset: readHtmlEditingChartDefault(node, element) };
    if (element.kind === "RANGE_TOKEN") return { kind: "RANGE_TOKEN", elementId: element.elementId,
      value: readHtmlEditingStyleRangeDefault(node, element) };
    const path = node.attr("src");
    const assetId = path === undefined ? null : element.allowedAssetIds.find(id => input.imageSources.get(id) === path) ?? null;
    const fit = node.css("object-fit")?.trim().toUpperCase();
    return { kind: "IMAGE", elementId: element.elementId, assetId, fit: fit === "CONTAIN" || fit === "COVER" ? fit : null };
  });
  const grants = new Set(input.grantedAssetIds);
  const view = htmlEditingInspectorViewSchema.parse({ format: "courseforge-html-editable-inspector-v1",
    revisionVersion: revision.version, revisionSha256: verified.sha256, compositionDocumentHash: input.compositionDocumentHash,
    manifest: { ...revision.manifest, binding }, state: revision.state, defaults,
    grantedAssetIds: [...grants].sort(), usedResourcesGranted: verified.compiled.usedAssetIds.every(id => grants.has(id)) });
  if (Buffer.byteLength(JSON.stringify(view), "utf8") > HTML_EDITING_INSPECTOR_POLICY.responseBytes) throw new HtmlEditingRevisionError("READ_UNAVAILABLE");
  return view;
}

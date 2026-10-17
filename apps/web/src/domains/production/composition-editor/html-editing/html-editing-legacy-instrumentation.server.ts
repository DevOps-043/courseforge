import { createHash } from "node:crypto";
import type { Element } from "domhandler";
import { HTML_EDITING_LIMITS, htmlEditingSetOverrideSchema, type HtmlEditableManifest } from "./html-editing.contract";
import { prepareInitialHtmlEditingRevision, htmlEditingTrustedTemplateSchema } from "./html-editing-bootstrap.server";
import { parseHtmlEditingStaticSource } from "./html-editing-static-source.server";
import { HtmlEditingValidationError } from "./html-editing-validation";
import { HTML_EDITING_COMPILATION_PROFILE } from "./html-editing-compilation-profile";
import { canonicalHtmlEditingJson } from "./html-editing-canonical-json.server";

export const HTML_LEGACY_INSTRUMENTATION_VERSION = "courseforge-html-legacy-instrumentation-v1";
export const HTML_LEGACY_INSTRUMENTATION_POLICY = Object.freeze({ maximumSemanticPathBytes: 16 * 1024,
  maximumTargetMapBytes: 512 * 1024 });
const editableAttribute = "data-courseforge-editable-id";
const stableId = /^[a-zA-Z][a-zA-Z0-9_-]{0,95}$/;
const textTags = new Set(["p", "span", "strong", "em", "b", "i", "h1", "h2", "h3", "h4", "h5", "h6", "li", "figcaption"]);
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
type InitialParameters = Parameters<typeof prepareInitialHtmlEditingRevision>[0];
type Declaration = HtmlEditableManifest["elements"][number];

function isElement(node: unknown): node is Element {
  return !!node && typeof node === "object" && "type" in node
    && ["tag", "style", "script"].includes(String(node.type));
}

/** An existing ID is a semantic anchor, otherwise tag/role and occurrence among
 * equivalent siblings form the path. This is not a global nth-child index.
 * Inserting a different kind of sibling leaves identities unchanged. Reordering
 * equivalent anonymous siblings requires a new reviewed template version. */
function semanticSegment(element: Element): string {
  if (element.attribs.id) return JSON.stringify([element.name, "id", element.attribs.id]);
  const role = element.attribs.role ?? "";
  const siblings = element.parent && "children" in element.parent ? element.parent.children : [element];
  let occurrence = 0;
  for (const sibling of siblings) {
    if (sibling === element) break;
    if (isElement(sibling) && sibling.name === element.name && !sibling.attribs.id
      && (sibling.attribs.role ?? "") === role) occurrence++;
  }
  return JSON.stringify([element.name, "role", role, occurrence]);
}

/** Offline authoring only. It returns a separate candidate, never registers or
 * activates a template, changes a saved DECK, grants assets, or sanitizes active
 * content into apparent trust. Caller must independently authorize inventory and
 * review the original/candidate visually before installation in the operator
 * catalogue. No HTML from this result may be rendered outside the sandbox. */
export function prepareLegacyHtmlEditingPilot(params: {
  sourceHtml: string;
  templateId: string;
  templateVersion: number;
  authoritativeAnchor: InitialParameters["authoritativeAnchor"];
  grantedAssetIds: readonly string[];
  imageSources: ReadonlyMap<string, string>;
}) {
  if (!htmlEditingTrustedTemplateSchema.pick({ templateId: true, templateVersion: true })
    .safeParse({ templateId: params.templateId, templateVersion: params.templateVersion }).success)
    throw new HtmlEditingValidationError("INVALID_MANIFEST");
  if (params.imageSources.size > HTML_EDITING_LIMITS.elements * HTML_EDITING_LIMITS.choices)
    throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
  const fragment = parseHtmlEditingStaticSource(params.sourceHtml);
  const elements = fragment("*").toArray().map(element => {
    if (!isElement(element)) throw new HtmlEditingValidationError("INVALID_SOURCE");
    return element;
  });
  const existingIds = new Set<string>();
  for (const element of elements) {
    const id = element.attribs.id;
    if (id !== undefined && (!id || existingIds.has(id))) throw new HtmlEditingValidationError("INVALID_SOURCE");
    if (id !== undefined) existingIds.add(id);
    if (element.attribs[editableAttribute] !== undefined) throw new HtmlEditingValidationError("INVALID_SOURCE");
  }
  const paths = new Map<Element, readonly string[]>();
  const declarations: Declaration[] = [];
  const targets: Array<{ elementId: string; kind: "TEXT" | "IMAGE"; semanticPath: readonly string[]; retainedId: boolean }> = [];
  let targetMapBytes = 2; // JSON array delimiters; paths may repeat ancestor IDs.
  // Cheerio's document traversal is parent-first; source depth/size are already bounded.
  for (const element of elements) {
    const parentPath = isElement(element.parent) ? paths.get(element.parent) : undefined;
    paths.set(element, [...(parentPath ?? []), semanticSegment(element)]);
  }
  // Snapshot every path before adding IDs: new sibling IDs must not influence
  // occurrence counting of later anonymous siblings.
  for (const element of elements) {
    const path = paths.get(element)!;
    const node = fragment(element);
    const tag = element.name.toLowerCase();
    const text = node.text();
    const textCandidate = textTags.has(tag) && node.children().length === 0 && text.trim().length > 0;
    if (!textCandidate && tag !== "img") continue;
    if (Buffer.byteLength(JSON.stringify(path), "utf8") > HTML_LEGACY_INSTRUMENTATION_POLICY.maximumSemanticPathBytes)
      throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
    if (declarations.length >= HTML_EDITING_LIMITS.elements) throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
    const retainedId = element.attribs.id !== undefined;
    // Renaming an existing ID could break CSS/ARIA/SVG references. Do not guess.
    if (retainedId && !stableId.test(element.attribs.id)) throw new HtmlEditingValidationError("INVALID_SOURCE");
    const elementId = retainedId ? element.attribs.id : `cf_${sha256(JSON.stringify([
      HTML_LEGACY_INSTRUMENTATION_VERSION, params.templateId, path,
    ]))}`;
    if (!retainedId && existingIds.has(elementId)) throw new HtmlEditingValidationError("INVALID_SOURCE");
    existingIds.add(elementId);
    let declaration: Declaration;
    if (textCandidate) {
      if (!htmlEditingSetOverrideSchema.safeParse({ operation: "SET_TEXT", elementId, value: text }).success)
        throw new HtmlEditingValidationError("INVALID_SOURCE");
      declaration = { kind: "TEXT", elementId, label: `${tag} ${targets.length + 1}`,
        maxCharacters: HTML_EDITING_LIMITS.textCharacters, multiline: true };
    } else {
      const matches = [...params.imageSources].filter(([, localPath]) => localPath === node.attr("src"));
      if (matches.length !== 1) throw new HtmlEditingValidationError("ASSET_SOURCE_MISSING");
      declaration = { kind: "IMAGE", elementId, label: `img ${targets.length + 1}`,
        allowedAssetIds: [matches[0][0]], allowedFits: ["CONTAIN", "COVER"] };
    }
    node.attr("id", elementId).attr(editableAttribute, elementId);
    declarations.push(declaration);
    const target = { elementId, kind: declaration.kind, semanticPath: path, retainedId };
    targetMapBytes += Buffer.byteLength(JSON.stringify(target), "utf8") + (targets.length ? 1 : 0);
    if (targetMapBytes > HTML_LEGACY_INSTRUMENTATION_POLICY.maximumTargetMapBytes)
      throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
    targets.push(target);
  }
  const candidateSourceHtml = fragment.html();
  const template = htmlEditingTrustedTemplateSchema.safeParse({
    format: "courseforge-html-editable-template-v1", templateId: params.templateId,
    templateVersion: params.templateVersion, sourceSha256: sha256(candidateSourceHtml), elements: declarations,
  });
  if (!template.success) throw new HtmlEditingValidationError("INVALID_MANIFEST");
  // Shared static compiler rejects active markup, unknown resources, revoked
  // images, invalid defaults and aggregate limits. No divergent legacy renderer.
  const verification = prepareInitialHtmlEditingRevision({
    authoritativeAnchor: params.authoritativeAnchor, encodedTrustedTemplate: JSON.stringify(template.data),
    sourceHtml: candidateSourceHtml, grantedAssetIds: params.grantedAssetIds, imageSources: params.imageSources,
  });
  const provenance = {
    format: "courseforge-html-legacy-pilot-provenance-v1" as const,
    instrumentationVersion: HTML_LEGACY_INSTRUMENTATION_VERSION,
    compilationProfile: { ...HTML_EDITING_COMPILATION_PROFILE },
    nativeAnchor: { ...params.authoritativeAnchor },
    originalSourceSha256: sha256(params.sourceHtml),
    candidateSourceSha256: template.data.sourceSha256,
    templateSha256: sha256(canonicalHtmlEditingJson(template.data)),
    targetsSha256: sha256(canonicalHtmlEditingJson(targets.map(target => ({ ...target, semanticPath: [...target.semanticPath] })))),
    compiledSha256: verification.compiled.compiledSha256,
  };
  return {
    format: HTML_LEGACY_INSTRUMENTATION_VERSION,
    status: "REVIEW_REQUIRED" as const,
    original: { sourceHtml: params.sourceHtml, sha256: sha256(params.sourceHtml) },
    candidate: { sourceHtml: candidateSourceHtml, sha256: template.data.sourceSha256,
      compiledSha256: verification.compiled.compiledSha256, template: template.data, targets },
    provenance,
    provenanceSha256: sha256(canonicalHtmlEditingJson(provenance)),
    requiredReviews: ["VISUAL_COMPARISON", "MANIFEST_AND_ACCESSIBILITY", "AUTHORIZED_INSTALLATION"] as const,
  };
}

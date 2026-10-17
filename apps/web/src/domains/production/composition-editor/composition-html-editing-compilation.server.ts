import { load } from "cheerio";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document.service";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";
import { HTML_EDITING_REVISION_POLICY } from "./html-editing/html-editing-revision.contract";
import { verifyHtmlEditingRevision, type HtmlEditingRevisionAuthority } from "./html-editing/html-editing-revision.server";
import { createLocalHtmlResourceValidator } from "./html-editing/html-local-resource-policy.server";

const maximumCompilationRevisionBytes = 16 * 1024 * 1024;

/** Host-owned authority, never obtained from a preview request. An exact reader
 * must supply the revisions selected by native pointers, not the latest rows. */
export type CompositionHtmlEditingCompilation = {
  organizationId: string;
  documentId: string;
  documentHash: string;
  revisions: readonly (HtmlEditingRevisionAuthority & { encodedRevision: string })[];
};

export class CompositionHtmlEditingCompilationError extends Error {
  constructor(readonly code: "CONTEXT_REQUIRED" | "DOCUMENT_MISMATCH" | "REVISION_SET_MISMATCH"
    | "REVISION_MISMATCH" | "LOCAL_RESOURCE_REQUIRED" | "ASSEMBLED_ID_COLLISION" | "PAYLOAD_LIMIT") {
    super(`HTML_EDITING_COMPILATION_${code}`);
    this.name = "CompositionHtmlEditingCompilationError";
  }
}

/** Resolves hash-bound derivations without replacing the original native source
 * or its hash. This local-resource consumer is shared by both compiler targets;
 * it does not attest materialized bytes or authenticate the supplied authority. */
export function compileCompositionHtmlEditingFragments(params: {
  document: CompositionEditorDocument;
  documentHash?: string;
  context?: CompositionHtmlEditingCompilation;
  assetUrls: ReadonlyMap<string, string>;
}): ReadonlyMap<string, string> {
  const references = params.document.htmlEditing?.items ?? [];
  if (!references.length && !params.context) return new Map();
  const context = params.context;
  if (!context) throw new CompositionHtmlEditingCompilationError("CONTEXT_REQUIRED");
  const document = compositionEditorDocumentSchema.parse(params.document);
  const documentHash = hashCompositionDocument(document);
  if (params.documentHash !== documentHash || context.documentHash !== documentHash) {
    throw new CompositionHtmlEditingCompilationError("DOCUMENT_MISMATCH");
  }
  if (context.revisions.length !== references.length || context.revisions.length > HTML_EDITING_LIMITS.elements) {
    throw new CompositionHtmlEditingCompilationError("REVISION_SET_MISMATCH");
  }
  let bytes = 0;
  const fragments = new Map<string, string>();
  for (const entry of context.revisions) {
    if (typeof entry.encodedRevision !== "string"
      || entry.encodedRevision.length > HTML_EDITING_REVISION_POLICY.maximumBytes) {
      throw new CompositionHtmlEditingCompilationError("PAYLOAD_LIMIT");
    }
    bytes += Buffer.byteLength(entry.encodedRevision, "utf8");
    if (bytes > maximumCompilationRevisionBytes) throw new CompositionHtmlEditingCompilationError("PAYLOAD_LIMIT");
    const binding = entry.authoritativeBinding;
    const reference = references.find(item => item.clipId === binding.clipId);
    const clip = document.clips.find(item => item.id === binding.clipId);
    if (!reference || fragments.has(binding.clipId) || binding.organizationId !== context.organizationId
      || binding.documentId !== context.documentId || !clip || clip.source.type !== "DECK_SLIDE") {
      throw new CompositionHtmlEditingCompilationError("REVISION_SET_MISMATCH");
    }
    const verified = verifyHtmlEditingRevision(entry);
    if (verified.sha256 !== reference.revisionSha256 || verified.revision.version !== reference.revisionVersion
      || binding.templateId !== reference.templateId || binding.templateVersion !== reference.templateVersion
      || binding.sourceSha256 !== reference.sourceSha256 || binding.manifestSha256 !== reference.manifestSha256
      || verified.revision.sourceHtml !== clip.source.html) {
      throw new CompositionHtmlEditingCompilationError("REVISION_MISMATCH");
    }
    // Logical aliases alone are not proof of a delivered resource. The host must
    // explicitly bind every used image to this exact local materialization path.
    for (const assetId of verified.compiled.usedAssetIds) {
      if (params.assetUrls.get(assetId) !== `conformance-media/${assetId}`) {
        throw new CompositionHtmlEditingCompilationError("LOCAL_RESOURCE_REQUIRED");
      }
    }
    fragments.set(binding.clipId, verified.compiled.html);
  }
  return fragments;
}

/** Validate after assembly, including legacy fragments, wrappers and overlays.
 * Do not prefix IDs: doing so would silently break author CSS and SVG references. */
export function assertCompositionHtmlEditingIdsUnique(html: string): void {
  const page = load(html);
  const ids = new Set<string>();
  page("[id]").each((_index, element) => {
    const id = page(element).attr("id")!;
    if (!id || ids.has(id)) throw new CompositionHtmlEditingCompilationError("ASSEMBLED_ID_COLLISION");
    ids.add(id);
  });
}

/** Validate the actual assembled clip markup, after legacy URL replacement,
 * rather than granting an unchecked neighbouring deck the same document. */
export function assertCompositionHtmlEditingResourcesLocal(params: {
  clipsHtml: string; deckCss: string; assetUrls: ReadonlyMap<string, string>;
}): void {
  const localFiles = new Set([...params.assetUrls].filter(([assetId, path]) =>
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(assetId)
    && path === `conformance-media/${assetId}`).map(([, path]) => path));
  try {
    const validator = createLocalHtmlResourceValidator({ localFiles, remoteToLocal: new Map() });
    validator.assertCss(params.deckCss);
    validator.assertFragment(params.clipsHtml);
  } catch { throw new CompositionHtmlEditingCompilationError("LOCAL_RESOURCE_REQUIRED"); }
}

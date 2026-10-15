import { createHash } from "node:crypto";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT, type HtmlEditingReference } from "./html-editing/html-editing-reference.contract";
import { verifyHtmlEditingRevision, type HtmlEditingRevisionAuthority } from "./html-editing/html-editing-revision.server";
import { HtmlEditingRevisionError, type HtmlEditingRevision } from "./html-editing/html-editing-revision.contract";
import { hashCompositionDocument } from "./composition-document.service";

/** Exact native document reference, never an out-of-document render option. */
export function bindHtmlEditingRevisionToComposition(params: HtmlEditingRevisionAuthority & {
  document: CompositionEditorDocument; revision: HtmlEditingRevision; revisionSha256: string;
}): { document: CompositionEditorDocument; documentHash: string } {
  const current = compositionEditorDocumentSchema.parse(params.document);
  const verified = verifyHtmlEditingRevision({ ...params, encodedRevision: JSON.stringify(params.revision) });
  if (verified.sha256 !== params.revisionSha256) throw new HtmlEditingRevisionError("REVISION_CONFLICT");
  const binding = verified.revision.manifest.binding;
  const clip = current.clips.find(candidate => candidate.id === binding.clipId);
  if (!clip || clip.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE"
    || clip.source.html !== verified.revision.sourceHtml
    || createHash("sha256").update(clip.source.html, "utf8").digest("hex") !== binding.sourceSha256) {
    throw new HtmlEditingRevisionError("RESTORE_SOURCE_MISMATCH");
  }
  const reference: HtmlEditingReference = {
    clipId: binding.clipId, revisionVersion: verified.revision.version, revisionSha256: verified.sha256,
    templateId: binding.templateId, templateVersion: binding.templateVersion,
    sourceSha256: binding.sourceSha256, manifestSha256: binding.manifestSha256,
  };
  const next = compositionEditorDocumentSchema.parse({ ...current, format: HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT,
    htmlEditing: { format: "courseforge-html-editable-references-v1", items: [
      ...(current.htmlEditing?.items || []).filter(item => item.clipId !== binding.clipId), reference,
    ].sort((left, right) => left.clipId < right.clipId ? -1 : left.clipId > right.clipId ? 1 : 0) },
  });
  return { document: next, documentHash: hashCompositionDocument(next) };
}

import { createHash } from "node:crypto";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

export function createHtmlReconstructionFixture() {
  const source = createHtmlEditingRevisionFixture(), document = compositionEditorDocumentSchema.parse({...source.document,
    clips: [source.document.clips[0]]});
  const origin = {scope: "AUTHORIZED_RECONSTRUCTION_ORIGIN_NOT_EXECUTION_OR_APPROVAL" as const, organizationId: uuid,
    compositionId: uuid, draftId: uuid, documentId: uuid, revisionId: uuid,
    documentHash: "a".repeat(64), projectHash: "b".repeat(64), bundleSha256: "c".repeat(64)};
  const template = {format: "courseforge-html-editable-template-v1", templateId: "intro", templateVersion: 1,
    sourceSha256: source.current.revision.manifest.binding.sourceSha256, elements: source.current.revision.manifest.elements};
  const catalog = new HtmlEditingTemplateCatalog(JSON.stringify({format: "courseforge-html-editable-catalog-v1", organizationId: uuid, templates: [template]}));
  return {origin, target: {compositionId: other, documentId: other, revisionId: other,
    slides: [{clipId: document.clips[0].id, templateId: "intro", templateVersion: 1}]},
    document, expectedDocumentHash: hashCompositionDocument(document), catalog,
    grantedAssetIds: source.authority.grantedAssetIds, imageSources: source.authority.imageSources};
}

export function createMultipageHtmlReconstructionFixture(collision = false, unsafeSource = false) {
  const f = createHtmlReconstructionFixture(), source = createHtmlEditingRevisionFixture();
  const templates = [0, 1, 2].map(index => {
    const suffix = collision ? "" : `-${index}`;
    const html = source.current.revision.sourceHtml.replace('id="title"', `id="title${suffix}"`)
      .replace('id="photo"', `id="photo${suffix}"`) + (unsafeSource && index === 1 ? "<script>unsafe()</script>" : "");
    return {format: "courseforge-html-editable-template-v1", templateId: `page-${index}`, templateVersion: 1,
      sourceSha256: createHash("sha256").update(html).digest("hex"),
      elements: source.current.revision.manifest.elements.map(element => ({...element, elementId: element.elementId + suffix})), html};
  });
  f.document.canvas.durationSeconds = 12;
  f.document.clips = templates.map((template, index) => ({...source.document.clips[0],
    id: `page-${index}`, hfId: `page-${index}`, startSeconds: index * 4,
    source: {type: "DECK_SLIDE" as const, html: template.html, slideIndex: index, classes: "slide"}}));
  f.target.slides = templates.map((template, index) => ({clipId: `page-${index}`,
    templateId: template.templateId, templateVersion: template.templateVersion}));
  f.catalog = new HtmlEditingTemplateCatalog(JSON.stringify({format: "courseforge-html-editable-catalog-v1", organizationId: uuid,
    templates: templates.map(template => ({format: template.format, templateId: template.templateId,
      templateVersion: template.templateVersion, sourceSha256: template.sourceSha256, elements: template.elements}))}));
  f.expectedDocumentHash = hashCompositionDocument(f.document);
  return f;
}

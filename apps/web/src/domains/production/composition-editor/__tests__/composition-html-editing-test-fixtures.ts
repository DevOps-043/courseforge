import { createHash } from "node:crypto";
import { createTransitionDocument } from "./composition-transition-test-fixtures";
import { hashCompositionDocument } from "../composition-document.service";
import { computeHtmlEditableManifestSha256 } from "../html-editing/html-editing-manifest-digest.server";
import { verifyHtmlEditingRevision, prepareHtmlEditingRevisionCommand } from "../html-editing/html-editing-revision.server";
import type { HtmlEditableManifest } from "../html-editing/html-editing.contract";
import type { HtmlEditingRevision } from "../html-editing/html-editing-revision.contract";

export const htmlEditingFixtureId = "11111111-1111-4111-8111-111111111111";
export const htmlEditingFixtureOtherId = "22222222-2222-4222-8222-222222222222";
export function createHtmlEditingRevisionFixture(sourceHtml = `<section><h1 id="title">Original</h1><img id="photo" src="conformance-media/${htmlEditingFixtureId}"></section>`) {
  const uuid = htmlEditingFixtureId;
  const other = htmlEditingFixtureOtherId;
  const document = createTransitionDocument();
  const clip = document.clips[0]!;
  clip.kind = "DECK_SLIDE";
  clip.source = { type: "DECK_SLIDE", html: sourceHtml, slideIndex: 0, classes: "slide active" };
  const binding = { organizationId: uuid, documentId: uuid, revisionId: other, documentSha256: hashCompositionDocument(document),
    clipId: clip.id, templateId: "intro", templateVersion: 1,
    sourceSha256: createHash("sha256").update(sourceHtml).digest("hex"), manifestSha256: "0".repeat(64) };
  const manifest: HtmlEditableManifest = { format: "courseforge-html-editable-manifest-v1", binding, elements: [
    { kind: "TEXT", elementId: "title", label: "Title", maxCharacters: 100, multiline: false },
    { kind: "IMAGE", elementId: "photo", label: "Photo", allowedAssetIds: [uuid, other], allowedFits: ["COVER"] },
  ] };
  binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(manifest), binding);
  const revision: HtmlEditingRevision = { format: "courseforge-html-editable-revision-v1", version: 1, sourceHtml, manifest,
    state: { format: "courseforge-html-editable-override-state-v1", binding, overrides: [] } };
  const authority = { authoritativeBinding: binding, grantedAssetIds: [uuid, other],
    imageSources: new Map([[uuid, `conformance-media/${uuid}`], [other, `conformance-media/${other}`]]) };
  const current = verifyHtmlEditingRevision({ ...authority, encodedRevision: JSON.stringify(revision) });
  const command = JSON.stringify({ format: "courseforge-html-editable-command-v1", binding,
    overrides: [{ operation: "SET_TEXT", elementId: "title", value: "Changed" }] });
  const next = prepareHtmlEditingRevisionCommand({ ...authority, encodedRevision: JSON.stringify(revision),
    expected: { version: 1, sha256: current.sha256 }, encodedCommand: command }).next;
  return { document, authority, current, next, request: { actorId: uuid, scope: { organizationId: uuid, documentId: uuid, clipId: clip.id } },
    row: { revision, revisionSha256: current.sha256, document, compositionDocumentHash: hashCompositionDocument(document), grantedAssetIds: [uuid, other] } };
}

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  HTML_EDITING_LIMITS, htmlEditableManifestSchema, htmlEditingBindingSchema,
} from "./html-editing.contract";
import { computeHtmlEditableManifestSha256 } from "./html-editing-manifest-digest.server";
import { verifyHtmlEditingRevision, type VerifiedHtmlEditingRevision } from "./html-editing-revision.server";
import { decodeHtmlEditingBoundedJson, HtmlEditingValidationError } from "./html-editing-validation";

const anchorSchema = htmlEditingBindingSchema.pick({
  organizationId: true, documentId: true, revisionId: true, documentSha256: true, clipId: true,
});
export const htmlEditingTrustedTemplateSchema = z.object({
  format: z.literal("courseforge-html-editable-template-v1"),
  templateId: htmlEditingBindingSchema.shape.templateId,
  templateVersion: htmlEditingBindingSchema.shape.templateVersion,
  sourceSha256: htmlEditingBindingSchema.shape.sourceSha256,
  elements: htmlEditableManifestSchema.shape.elements,
}).strict();

/** Host-only preparation. Template declarations must come from an independently
 * trusted catalog, anchor/source from the saved authorized DECK_SLIDE, and grants
 * from current server records. This function is NOT authorization or persistence.
 * It neither instruments arbitrary HTML nor changes native source/timing/hash.
 * Registration must recheck actor, saved hash/source and grants transactionally. */
export function prepareInitialHtmlEditingRevision(params: {
  authoritativeAnchor: z.infer<typeof anchorSchema>;
  encodedTrustedTemplate: string;
  sourceHtml: string;
  grantedAssetIds: readonly string[];
  imageSources: ReadonlyMap<string, string>;
}): VerifiedHtmlEditingRevision {
  const anchor = anchorSchema.safeParse(params.authoritativeAnchor);
  const template = htmlEditingTrustedTemplateSchema.safeParse(decodeHtmlEditingBoundedJson(
    params.encodedTrustedTemplate, HTML_EDITING_LIMITS.manifestBytes,
  ));
  if (!anchor.success || !template.success) throw new HtmlEditingValidationError("INVALID_MANIFEST");
  if (typeof params.sourceHtml !== "string" || params.sourceHtml.length === 0) {
    throw new HtmlEditingValidationError("INVALID_SOURCE");
  }
  if (params.sourceHtml.length > HTML_EDITING_LIMITS.sourceBytes
    || Buffer.byteLength(params.sourceHtml, "utf8") > HTML_EDITING_LIMITS.sourceBytes) {
    throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
  }
  const sourceSha256 = createHash("sha256").update(params.sourceHtml, "utf8").digest("hex");
  if (sourceSha256 !== template.data.sourceSha256) throw new HtmlEditingValidationError("SOURCE_DIGEST_MISMATCH");
  // The only placeholder is the manifest's own digest slot; all scope and source
  // identities are already fixed before computing the domain-separated digest.
  const binding = { ...anchor.data, templateId: template.data.templateId,
    templateVersion: template.data.templateVersion, sourceSha256, manifestSha256: "0".repeat(64) };
  const manifest = { format: "courseforge-html-editable-manifest-v1" as const,
    binding, elements: template.data.elements };
  binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(manifest), binding);
  return verifyHtmlEditingRevision({
    authoritativeBinding: binding, grantedAssetIds: params.grantedAssetIds, imageSources: params.imageSources,
    encodedRevision: JSON.stringify({
      format: "courseforge-html-editable-revision-v1", version: 1, sourceHtml: params.sourceHtml, manifest,
      state: { format: "courseforge-html-editable-override-state-v1", binding, overrides: [] },
    }),
  });
}

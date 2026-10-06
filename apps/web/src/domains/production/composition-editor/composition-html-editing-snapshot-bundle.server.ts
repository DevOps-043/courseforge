import { createHash } from "node:crypto";
import { z } from "zod";
import type { CompositionEditorDocument } from "./composition-document.types";
import { compileCompositionHtmlEditingFragments, type CompositionHtmlEditingCompilation } from "./composition-html-editing-compilation.server";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";
import { canonicalHtmlEditingJson } from "./html-editing/html-editing-canonical-json.server";
import { htmlEditingRevisionSchema } from "./html-editing/html-editing-revision.contract";
import type { HtmlEditingRevisionAuthority } from "./html-editing/html-editing-revision.server";
import { decodeHtmlEditingBoundedJson } from "./html-editing/html-editing-validation";
import { createLocalHtmlResourceValidator } from "./html-editing/html-local-resource-policy.server";

export const HTML_EDITING_SNAPSHOT_BUNDLE_POLICY = Object.freeze({
  archivePath: "html-editing-revisions.json", maximumBytes: 16 * 1024 * 1024,
});
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const scopeSchema = z.object({ organizationId: z.string().uuid(), documentId: z.string().uuid() }).strict();
const bundleSchema = z.object({
  format: z.literal("courseforge-html-editable-snapshot-bundle-v1"), schemaVersion: z.literal(1),
  organizationId: z.string().uuid(), documentId: z.string().uuid(), documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  revisions: z.array(htmlEditingRevisionSchema).min(1).max(HTML_EDITING_LIMITS.elements)
    .refine(revisions => new Set(revisions.map(revision => revision.manifest.binding.clipId)).size === revisions.length),
}).strict();

export class HtmlEditingSnapshotBundleError extends Error {
  constructor(readonly code: "INVALID_BUNDLE" | "BYTE_INTEGRITY_MISMATCH" | "SCOPE_MISMATCH" | "AUTHORITY_SET_MISMATCH") {
    super(`HTML_EDITING_SNAPSHOT_${code}`);
    this.name = "HtmlEditingSnapshotBundleError";
  }
}

export type HtmlEditingFrozenSnapshotBundle = {
  archivePath: typeof HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.archivePath; encodedBundle: string; sha256: string;
};
export type HtmlEditingFrozenCompilationInput = HtmlEditingFrozenSnapshotBundle & {
  scope: z.infer<typeof scopeSchema>;
  // Must be obtained independently from current authorized backend state, not
  // decoded from the archive. Permission snapshots are intentionally not stored.
  authorities: readonly HtmlEditingRevisionAuthority[];
};

function logicalAliases(authorities: readonly HtmlEditingRevisionAuthority[]) {
  return new Map(authorities.flatMap(authority => authority.grantedAssetIds.map(id =>
    [id, `conformance-media/${id}`] as [string, string])));
}

/** Freeze content only after exact pointer/scope/source/grant verification. This
 * prepares archive bytes, not a ZIP upload, permission receipt or render proof. */
export function freezeCompositionHtmlEditingSnapshot(params: {
  document: CompositionEditorDocument; context: CompositionHtmlEditingCompilation;
}): HtmlEditingFrozenSnapshotBundle {
  try {
    compileCompositionHtmlEditingFragments({ document: params.document, documentHash: params.context.documentHash,
      context: params.context, assetUrls: logicalAliases(params.context.revisions) });
    const revisions = params.context.revisions.map(entry => htmlEditingRevisionSchema.parse(
      decodeHtmlEditingBoundedJson(entry.encodedRevision, HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes)))
      .sort((left, right) => left.manifest.binding.clipId < right.manifest.binding.clipId ? -1
        : left.manifest.binding.clipId > right.manifest.binding.clipId ? 1 : 0);
    const bundle = bundleSchema.parse({ format: "courseforge-html-editable-snapshot-bundle-v1", schemaVersion: 1,
      organizationId: params.context.organizationId, documentId: params.context.documentId,
      documentHash: params.context.documentHash, revisions });
    const encodedBundle = canonicalHtmlEditingJson(bundle);
    if (Buffer.byteLength(encodedBundle, "utf8") > HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes) throw new Error();
    return { archivePath: HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.archivePath, encodedBundle, sha256: sha256(encodedBundle) };
  } catch { throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE"); }
}

/** Restore frozen content with independently refreshed authority. A bundle's
 * claimed hash never grants access; native pointers still bind every revision. */
export function restoreCompositionHtmlEditingSnapshot(params: HtmlEditingFrozenCompilationInput & {
  document: CompositionEditorDocument; documentHash?: string;
}): CompositionHtmlEditingCompilation {
  const bundle = parsePinnedBundle(params);
  const scope = scopeSchema.safeParse(params.scope);
  if (!scope.success || scope.data.organizationId !== bundle.organizationId || scope.data.documentId !== bundle.documentId
    || params.documentHash !== bundle.documentHash) throw new HtmlEditingSnapshotBundleError("SCOPE_MISMATCH");
  if (params.authorities.length !== bundle.revisions.length) throw new HtmlEditingSnapshotBundleError("AUTHORITY_SET_MISMATCH");
  const authorities = new Map(params.authorities.map(authority => [authority.authoritativeBinding.clipId, authority]));
  if (authorities.size !== params.authorities.length) throw new HtmlEditingSnapshotBundleError("AUTHORITY_SET_MISMATCH");
  const context: CompositionHtmlEditingCompilation = { ...scope.data, documentHash: bundle.documentHash,
    revisions: bundle.revisions.map(revision => {
      const authority = authorities.get(revision.manifest.binding.clipId);
      if (!authority) throw new HtmlEditingSnapshotBundleError("AUTHORITY_SET_MISMATCH");
      return { ...authority, encodedRevision: JSON.stringify(revision) };
    }) };
  try {
    compileCompositionHtmlEditingFragments({ document: params.document, documentHash: params.documentHash,
      context, assetUrls: logicalAliases(params.authorities) });
  } catch { throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE"); }
  return context;
}

function parsePinnedBundle(params: HtmlEditingFrozenSnapshotBundle): z.infer<typeof bundleSchema> {
  let bundle: z.infer<typeof bundleSchema>;
  try {
    if (params.archivePath !== HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.archivePath || typeof params.encodedBundle !== "string"
      || params.encodedBundle.length > HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes
      || Buffer.byteLength(params.encodedBundle, "utf8") > HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes) throw new Error();
  } catch { throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE"); }
  if (!/^[a-f0-9]{64}$/.test(params.sha256) || sha256(params.encodedBundle) !== params.sha256) {
    throw new HtmlEditingSnapshotBundleError("BYTE_INTEGRITY_MISMATCH");
  }
  try {
    bundle = bundleSchema.parse(decodeHtmlEditingBoundedJson(params.encodedBundle, HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes));
  } catch { throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE"); }
  return bundle;
}

/** OFFLINE CONTENT INTEGRITY ONLY. The selected native pointers authenticate
 * revision identity, NOT current access. Declared template images are used only
 * to derive expected source/text. Never return this as execution authority. */
export function verifyCompositionHtmlEditingSnapshotContent(params: HtmlEditingFrozenSnapshotBundle & {
  document: CompositionEditorDocument; documentHash: string;
}): { organizationId: string; documentId: string; fragments: ReadonlyMap<string, string>; usedAssetIds: readonly string[] } {
  const bundle = parsePinnedBundle(params);
  if (bundle.documentHash !== params.documentHash) throw new HtmlEditingSnapshotBundleError("SCOPE_MISMATCH");
  const revisions = bundle.revisions.map(revision => {
    const declaredImageIds = [...new Set(revision.manifest.elements.flatMap(element =>
      element.kind === "IMAGE" ? element.allowedAssetIds : []))];
    return { encodedRevision: JSON.stringify(revision), authoritativeBinding: revision.manifest.binding,
      grantedAssetIds: declaredImageIds, imageSources: new Map(declaredImageIds.map(id => [id, `conformance-media/${id}`])) };
  });
  try {
    const aliases = logicalAliases(revisions);
    const fragments = compileCompositionHtmlEditingFragments({ document: params.document, documentHash: params.documentHash,
      context: { organizationId: bundle.organizationId, documentId: bundle.documentId,
        documentHash: bundle.documentHash, revisions }, assetUrls: aliases });
    const resources = createLocalHtmlResourceValidator({ localFiles: new Set(aliases.values()), remoteToLocal: new Map() });
    for (const html of fragments.values()) resources.assertFragment(html);
    const usedAssetIds = [...aliases].filter(([, path]) => resources.referencedLocalFiles.has(path)).map(([id]) => id).sort();
    return { organizationId: bundle.organizationId, documentId: bundle.documentId, fragments, usedAssetIds };
  } catch { throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE"); }
}

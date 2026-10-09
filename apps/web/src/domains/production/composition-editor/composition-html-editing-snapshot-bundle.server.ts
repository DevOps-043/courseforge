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
import { HTML_EDITING_COMPILATION_PROFILE } from "./html-editing/html-editing-compilation-profile";

export const HTML_EDITING_SNAPSHOT_BUNDLE_POLICY = Object.freeze({
  archivePath: "html-editing-revisions.json", maximumBytes: 16 * 1024 * 1024,
});
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const scopeSchema = z.object({ organizationId: z.string().uuid(), documentId: z.string().uuid() }).strict();
const bundleSchema = z.object({
  format: z.literal("courseforge-html-editable-snapshot-bundle-v2"), schemaVersion: z.literal(2),
  organizationId: z.string().uuid(), documentId: z.string().uuid(), documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  compilation: z.object({
    profile: z.object({ compilerVersion: z.string().min(1).max(96), geometryVersion: z.string().min(1).max(96),
      isolationVersion: z.string().min(1).max(96) }).strict(),
    fragments: z.array(z.object({ clipId: z.string().min(1).max(96), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
      .min(1).max(HTML_EDITING_LIMITS.elements)
      .refine(fragments => new Set(fragments.map(fragment => fragment.clipId)).size === fragments.length),
  }).strict(),
  revisions: z.array(htmlEditingRevisionSchema).min(1).max(HTML_EDITING_LIMITS.elements)
    .refine(revisions => new Set(revisions.map(revision => revision.manifest.binding.clipId)).size === revisions.length),
}).strict();
const legacyBundleSchema = bundleSchema.omit({ compilation: true }).extend({
  format: z.literal("courseforge-html-editable-snapshot-bundle-v1"), schemaVersion: z.literal(1),
}).strict();

export class HtmlEditingSnapshotBundleError extends Error {
  constructor(readonly code: "INVALID_BUNDLE" | "BYTE_INTEGRITY_MISMATCH" | "SCOPE_MISMATCH" | "AUTHORITY_SET_MISMATCH"
    | "COMPILATION_VERSION_MISMATCH" | "COMPILATION_OUTPUT_MISMATCH") {
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
    const fragments = compileCompositionHtmlEditingFragments({ document: params.document, documentHash: params.context.documentHash,
      context: params.context, assetUrls: logicalAliases(params.context.revisions) });
    const revisions = params.context.revisions.map(entry => htmlEditingRevisionSchema.parse(
      decodeHtmlEditingBoundedJson(entry.encodedRevision, HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes)))
      .sort((left, right) => left.manifest.binding.clipId < right.manifest.binding.clipId ? -1
        : left.manifest.binding.clipId > right.manifest.binding.clipId ? 1 : 0);
    const bundle = bundleSchema.parse({ format: "courseforge-html-editable-snapshot-bundle-v2", schemaVersion: 2,
      organizationId: params.context.organizationId, documentId: params.context.documentId,
      documentHash: params.context.documentHash, revisions,
      compilation: { profile: HTML_EDITING_COMPILATION_PROFILE,
        fragments: revisions.map(revision => ({ clipId: revision.manifest.binding.clipId,
          sha256: sha256(fragments.get(revision.manifest.binding.clipId)!) })) },
    });
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
  const context = compilationContext(params, bundle);
  let fragments: ReadonlyMap<string, string>;
  try {
    fragments = compileCompositionHtmlEditingFragments({ document: params.document, documentHash: params.documentHash,
      context, assetUrls: logicalAliases(params.authorities) });
  } catch { throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE"); }
  assertPinnedCompilationOutput(bundle, fragments);
  return context;
}

function compilationContext(params: HtmlEditingFrozenCompilationInput & { documentHash?: string },
  bundle: z.infer<typeof bundleSchema> | z.infer<typeof legacyBundleSchema>): CompositionHtmlEditingCompilation {
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
  return context;
}

/** Explicit historical review only, never restore/commit or visual attestation.
 * Recompile exact native-selected content with CURRENT independent authority into
 * a separate candidate. The original pins remain unchanged and non-executable. */
export function prepareCompositionHtmlEditingSnapshotRepublication(params: HtmlEditingFrozenCompilationInput & {
  document: CompositionEditorDocument; documentHash: string;
}) {
  const decoded = decodePinnedBundle(params);
  const legacy = legacyBundleSchema.safeParse(decoded);
  let bundle: z.infer<typeof bundleSchema> | z.infer<typeof legacyBundleSchema>;
  if (legacy.success) bundle = legacy.data;
  else {
    const current = bundleSchema.safeParse(decoded);
    if (!current.success) throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE");
    bundle = current.data;
  }
  const priorCompilation = "compilation" in bundle ? bundle.compilation : null;
  if (priorCompilation && !profileDifferences(priorCompilation.profile).length)
    throw new HtmlEditingSnapshotBundleError("COMPILATION_VERSION_MISMATCH");
  const context = compilationContext(params, bundle);
  const candidate = freezeCompositionHtmlEditingSnapshot({ document: params.document, context });
  const candidateBundle = bundleSchema.parse(decodePinnedBundle(candidate));
  const priorFragments = priorCompilation ? new Map(priorCompilation.fragments.map(fragment =>
    [fragment.clipId, fragment.sha256])) : null;
  // A prior profile's hashes cannot be recomputed here. Missing/extra pins are
  // reported, not interpreted as equivalent or used as execution authority.
  const comparisons = candidateBundle.compilation.fragments.map(fragment => {
    const previousSha256 = priorFragments?.get(fragment.clipId) ?? null;
    return { clipId: fragment.clipId, previousSha256, candidateSha256: fragment.sha256,
      status: previousSha256 === null ? "NO_PRIOR_OUTPUT_PIN" as const
        : previousSha256 === fragment.sha256 ? "OUTPUT_PIN_EQUAL" as const : "OUTPUT_PIN_CHANGED" as const };
  });
  return {
    scope: "PREPARED_REPUBLICATION_NOT_COMMITTED" as const,
    originalBundleSha256: params.sha256,
    originalFormat: bundle.format,
    originalCompilationProfile: priorCompilation?.profile ?? null,
    candidateCompilationProfile: candidateBundle.compilation.profile,
    candidate,
    comparisons,
    unmatchedPriorClipIds: [...(priorFragments?.keys() ?? [])]
      .filter(clipId => !comparisons.some(comparison => comparison.clipId === clipId)).sort(),
    requiredReviews: ["HISTORICAL_VISUAL_COMPARISON", "CURRENT_CONTENT_AND_ACCESSIBILITY", "AUTHORIZED_REPUBLICATION"] as const,
  };
}

function decodePinnedBundle(params: HtmlEditingFrozenSnapshotBundle): unknown {
  try {
    if (params.archivePath !== HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.archivePath || typeof params.encodedBundle !== "string"
      || params.encodedBundle.length > HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes
      || Buffer.byteLength(params.encodedBundle, "utf8") > HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes) throw new Error();
  } catch { throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE"); }
  if (!/^[a-f0-9]{64}$/.test(params.sha256) || sha256(params.encodedBundle) !== params.sha256) {
    throw new HtmlEditingSnapshotBundleError("BYTE_INTEGRITY_MISMATCH");
  }
  try {
    return decodeHtmlEditingBoundedJson(params.encodedBundle, HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes);
  } catch { throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE"); }
}

function profileDifferences(profile: z.infer<typeof bundleSchema>["compilation"]["profile"]) {
  return (Object.keys(HTML_EDITING_COMPILATION_PROFILE) as Array<keyof typeof HTML_EDITING_COMPILATION_PROFILE>)
    .filter(key => profile[key] !== HTML_EDITING_COMPILATION_PROFILE[key]);
}

/** OFFLINE inventory diagnostic, never execution authority or migration consent.
 * Pins and expected scope come from the caller independently of archive bytes.
 * A current profile still requires native pointers/content/current grants checks.
 * Historical content is classified without running or upgrading its compiler. */
export function diagnoseCompositionHtmlEditingSnapshotCompatibility(params: HtmlEditingFrozenSnapshotBundle & {
  scope: { organizationId: string; documentId: string }; documentHash: string;
}) {
  const diagnosticScope = "OFFLINE_COMPATIBILITY_NOT_AUTHORIZATION" as const;
  try {
    const expectedScope = scopeSchema.safeParse(params.scope);
    if (!expectedScope.success || !/^[a-f0-9]{64}$/.test(params.documentHash))
      throw new HtmlEditingSnapshotBundleError("SCOPE_MISMATCH");
    const decoded = decodePinnedBundle(params);
    const legacy = legacyBundleSchema.safeParse(decoded);
    let bundle: z.infer<typeof bundleSchema> | z.infer<typeof legacyBundleSchema>;
    let differences: Array<keyof typeof HTML_EDITING_COMPILATION_PROFILE> = [];
    if (legacy.success) bundle = legacy.data;
    else {
      const current = bundleSchema.safeParse(decoded);
      if (!current.success) throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE");
      bundle = current.data;
      differences = profileDifferences(current.data.compilation.profile);
    }
    if (bundle.organizationId !== expectedScope.data.organizationId || bundle.documentId !== expectedScope.data.documentId
      || bundle.documentHash !== params.documentHash) throw new HtmlEditingSnapshotBundleError("SCOPE_MISMATCH");
    return { scope: diagnosticScope,
      status: legacy.success ? "LEGACY_V1_REQUIRES_REVIEW" as const
        : differences.length ? "PROFILE_MISMATCH_REQUIRES_REVIEW" as const
          : "CURRENT_PROFILE_REQUIRES_CONTENT_AND_AUTHORITY_CHECKS" as const,
      revisionCount: bundle.revisions.length, profileDifferences: differences };
  } catch (error) {
    return { scope: diagnosticScope, status: "REJECTED" as const,
      reason: error instanceof HtmlEditingSnapshotBundleError ? error.code : "INVALID_BUNDLE" as const };
  }
}

function parsePinnedBundle(params: HtmlEditingFrozenSnapshotBundle): z.infer<typeof bundleSchema> {
  let bundle: z.infer<typeof bundleSchema>;
  const decoded = decodePinnedBundle(params);
  try {
    if (decoded && typeof decoded === "object" && "format" in decoded
      && decoded.format === "courseforge-html-editable-snapshot-bundle-v1")
      throw new HtmlEditingSnapshotBundleError("COMPILATION_VERSION_MISMATCH");
    bundle = bundleSchema.parse(decoded);
  } catch (error) {
    if (error instanceof HtmlEditingSnapshotBundleError) throw error;
    throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE");
  }
  if (profileDifferences(bundle.compilation.profile).length)
    throw new HtmlEditingSnapshotBundleError("COMPILATION_VERSION_MISMATCH");
  return bundle;
}

function assertPinnedCompilationOutput(bundle: z.infer<typeof bundleSchema>, fragments: ReadonlyMap<string, string>): void {
  if (bundle.compilation.fragments.length !== fragments.size
    || bundle.compilation.fragments.some(expected => {
      const html = fragments.get(expected.clipId);
      return html === undefined || sha256(html) !== expected.sha256;
    })) throw new HtmlEditingSnapshotBundleError("COMPILATION_OUTPUT_MISMATCH");
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
    assertPinnedCompilationOutput(bundle, fragments);
    const resources = createLocalHtmlResourceValidator({ localFiles: new Set(aliases.values()), remoteToLocal: new Map() });
    for (const html of fragments.values()) resources.assertFragment(html);
    const usedAssetIds = [...aliases].filter(([, path]) => resources.referencedLocalFiles.has(path)).map(([id]) => id).sort();
    return { organizationId: bundle.organizationId, documentId: bundle.documentId, fragments, usedAssetIds };
  } catch (error) {
    if (error instanceof HtmlEditingSnapshotBundleError) throw error;
    throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE");
  }
}

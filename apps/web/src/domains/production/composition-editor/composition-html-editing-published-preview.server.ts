import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { conformanceReferenceSourceSchema } from "./composition-conformance-reference.service";
import { conformanceFontManifestSchema, conformanceFontManifestHash, conformanceFontPath } from "./composition-conformance-font-bindings";
import type { buildCompositionHtmlEditingPreviewInventory } from "./composition-html-editing-preview-inventory.server";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";
import { HTML_EDITING_SNAPSHOT_BUNDLE_POLICY } from "./composition-html-editing-snapshot-bundle.server";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.object({ organizationId: z.string().uuid(), documentId: z.string().uuid(),
  revisionId: z.string().uuid(), documentHash: hash }).strict();
const pinSchema = z.object({ schemaVersion: z.literal(1),
  path: z.literal(HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.archivePath), sha256: hash }).strict();
const rowSchema = z.object({ id: z.string().uuid(), organization_id: z.string().uuid(), manifest: z.object({
  snapshot: z.literal(true), draft_document_id: z.string().uuid(), draft_document_hash: hash,
  html_editing_snapshot: pinSchema,
  conformance_reference: conformanceReferenceSourceSchema,
  font_manifest: conformanceFontManifestSchema,
}).passthrough() }).strict();

/** Called only after host authentication/tenant/role checks. This lookup binds
 * publication identity, not authority to assets: the exact reader must still
 * reauthorize content/grants and preparation must match the frozen bundle pin. */
export async function readPublishedHtmlPreviewPin(input: z.infer<typeof requestSchema> & {
  supabase: SupabaseClient; signal?: AbortSignal;
}) {
  try {
    const request = requestSchema.parse({ organizationId: input.organizationId, documentId: input.documentId,
      revisionId: input.revisionId, documentHash: input.documentHash });
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs)])
      : AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
    signal.throwIfAborted();
    const result = await input.supabase.from("video_composition_revisions").select("id,organization_id,manifest")
      .eq("id", request.revisionId).eq("organization_id", request.organizationId).abortSignal(signal).maybeSingle();
    signal.throwIfAborted();
    if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "") > HTML_EDITING_REPOSITORY_POLICY.responseBytes) throw new Error();
    const row = rowSchema.parse(result.data), manifest = row.manifest;
    if (row.id !== request.revisionId || row.organization_id !== request.organizationId
      || manifest.draft_document_id !== request.documentId || manifest.draft_document_hash !== request.documentHash
      || manifest.conformance_reference.documentHash !== request.documentHash
      || manifest.html_editing_snapshot.sha256 !== manifest.conformance_reference.htmlEditingSnapshot?.sha256
      || manifest.conformance_reference.fontManifestSha256 !== conformanceFontManifestHash(manifest.font_manifest)) throw new Error();
    return { expectedFrozenBundleSha256: manifest.html_editing_snapshot.sha256,
      mediaBindings: manifest.conformance_reference.bindings, fontManifest: manifest.font_manifest };
  } catch { throw new Error("HTML_PUBLISHED_PREVIEW_UNAVAILABLE"); }
}

export type PublishedHtmlPreviewBinding = Awaited<ReturnType<typeof readPublishedHtmlPreviewPin>>;

/** Publication pins bind original media/font bytes in addition to HTML. A live
 * relink of the same asset UUID must never appear as its historical output. */
export function assertPublishedHtmlPreviewPortfolio(binding: PublishedHtmlPreviewBinding,
  inventory: ReturnType<typeof buildCompositionHtmlEditingPreviewInventory>) {
  const actualMedia = inventory.entries.filter(entry => entry.kind === "MEDIA").map(entry => ({
    assetId: entry.localPath.slice("conformance-media/".length), localPath: entry.localPath, ...entry.identity,
  })).sort((left, right) => left.localPath.localeCompare(right.localPath));
  const expectedMedia = [...binding.mediaBindings].sort((left, right) => left.localPath.localeCompare(right.localPath));
  if (!isDeepStrictEqual(actualMedia, expectedMedia) || inventory.fonts.size !== binding.fontManifest.length)
    throw new Error("HTML_PUBLISHED_PREVIEW_UNAVAILABLE");
  const fontPaths = new Set<string>();
  for (const font of binding.fontManifest) {
    const path = conformanceFontPath(font), face = inventory.fonts.get(font.fontAssetId);
    const entry = inventory.entries.find(resource => resource.kind === "FONT" && resource.localPath === path);
    if (!face || face.family !== font.family || face.sourceUrl !== path || !entry
      || entry.identity.checksum !== font.checksumSha256 || entry.identity.fileSizeBytes !== font.fileSizeBytes
      || entry.identity.mimeType !== font.mimeType) throw new Error("HTML_PUBLISHED_PREVIEW_UNAVAILABLE");
    fontPaths.add(path);
  }
  if (inventory.entries.filter(entry => entry.kind === "FONT").length !== fontPaths.size)
    throw new Error("HTML_PUBLISHED_PREVIEW_UNAVAILABLE");
}

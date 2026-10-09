import type { SupabaseClient } from "@supabase/supabase-js";
import { HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES } from "../hyperframes/hyperframes.types";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { readHtmlSnapshotNativeMedia } from "./composition-html-editing-snapshot-media.server";
import { htmlEditingImageIdentitySchema } from "./composition-html-editing-image-identity";
import { validateCompositionHtmlEditingPreviewImageBytes } from "./composition-html-editing-preview-images.server";
import { spoolCompositionHtmlEditingPreviewResource } from "./composition-html-editing-preview-spool.server";
import { htmlEditingPreviewStorageIdentitySchema } from "./composition-html-editing-preview-storage.server";

export const HTML_EDITING_PREVIEW_NATIVE_MEDIA_POLICY = Object.freeze({
  totalBytes: HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES, preparationTimeoutMs: 180_000,
});
export class HtmlEditingPreviewNativeMediaError extends Error {
  constructor() {
    super("HTML_EDITING_PREVIEW_NATIVE_MEDIA_UNAVAILABLE");
    this.name = "HtmlEditingPreviewNativeMediaError";
  }
}
type PrivateResource = Awaited<ReturnType<typeof spoolCompositionHtmlEditingPreviewResource>>;

/** Read-only native-media adapter. Caller first authorizes the exact document.
 * Reuses tenant/draft/status readers; never treats public URL or alias as a grant.
 * Files remain private, serving requires a separate fresh authority check.
 * No codec/decode attestations, renderer changes, jobs, thumbnails or cache. */
export async function prepareCompositionHtmlEditingPreviewNativeMedia(input:
  Parameters<typeof readHtmlSnapshotNativeMedia>[0] & {
    supabase: SupabaseClient; storageOrigin: string; fetchResource?: typeof fetch;
  }
) {
  const resources = new Map<string, PrivateResource>();
  const ownedResources: PrivateResource[] = [];
  const dispose = async () => {
    const outcomes = await Promise.allSettled(ownedResources.map(resource => resource.dispose()));
    if (outcomes.some(outcome => outcome.status === "rejected")) throw new HtmlEditingPreviewNativeMediaError();
  };
  try {
    const timeout = AbortSignal.timeout(HTML_EDITING_PREVIEW_NATIVE_MEDIA_POLICY.preparationTimeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const readerInput = { ...input, document: compositionEditorDocumentSchema.parse(input.document), signal };
    const initial = await readHtmlSnapshotNativeMedia(readerInput);
    if (initial.assets.reduce((total, asset) => total + asset.fileSizeBytes, 0) > HTML_EDITING_PREVIEW_NATIVE_MEDIA_POLICY.totalBytes) throw new Error();
    const identities = initial.assets.map(asset => {
      const { productionAssetId, ...identity } = asset;
      const storageIdentity = htmlEditingPreviewStorageIdentitySchema.parse(identity);
      if (asset.mimeType.startsWith("image/")) htmlEditingImageIdentitySchema.parse(asset);
      else if (!/^(audio|video)\//.test(asset.mimeType)) throw new Error();
      return { productionAssetId, storageIdentity };
    });
    for (const { productionAssetId, storageIdentity } of identities) {
      const resource = await spoolCompositionHtmlEditingPreviewResource({ ...input, identity: storageIdentity, signal });
      ownedResources.push(resource);
      resources.set(`conformance-media/${productionAssetId}`, resource);
      if (storageIdentity.mimeType.startsWith("image/")) {
        const bytes = await resource.readSmallBytes();
        await validateCompositionHtmlEditingPreviewImageBytes({ bytes,
          identity: htmlEditingImageIdentitySchema.parse({ ...storageIdentity, productionAssetId }), signal });
      }
    }
    const refreshed = await readHtmlSnapshotNativeMedia(readerInput);
    // Reader returns sorted manifests; compare named projections, never URLs as authority.
    const canonical = (result: typeof initial) => JSON.stringify({
      assets: result.assets.map(asset => [asset.productionAssetId, asset.checksum, asset.fileSizeBytes,
        asset.mimeType, asset.storageBucket, asset.storagePath]),
      deckPublicUrls: [...result.deckPublicUrls.entries()].sort(([first], [second]) => first.localeCompare(second)),
    });
    if (canonical(initial) !== canonical(refreshed)) throw new Error();
    signal.throwIfAborted();
    return {
      resources, dispose, assets: refreshed.assets, deckPublicUrls: refreshed.deckPublicUrls,
      assetUrls: new Map(refreshed.assets.map(asset => [asset.productionAssetId, `conformance-media/${asset.productionAssetId}`])),
      scope: "AUTHORIZED_BYTE_VERIFIED_NATIVE_PREVIEW_MEDIA_NOT_RENDER_EVIDENCE" as const,
    };
  } catch {
    await dispose();
    throw new HtmlEditingPreviewNativeMediaError();
  }
}

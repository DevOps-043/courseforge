import { createHash } from "node:crypto";
import { z } from "zod";
import { HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS, HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES, hyperframesAssetManifestSchema } from "../hyperframes/hyperframes.types";
import { ORGANIZATION_FONT_STORAGE_BUCKET, type OrganizationFontRecord } from "../fonts/organization-font.types";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { htmlEditingImageIdentitiesSchema, htmlEditingImageIdentitySchema } from "./composition-html-editing-image-identity";
import { assertDocumentConformanceFontBindings, CONFORMANCE_FONT_BINDING_LIMITS } from "./composition-conformance-font-bindings";
import { compiledCompositionFont, compositionFontArchivePath } from "./composition-font-assets.service";
import { htmlEditingPreviewStorageIdentitySchema, type HtmlEditingPreviewStorageIdentity } from "./composition-html-editing-preview-storage.server";
import { HTML_EDITING_PREVIEW_IMAGE_POLICY } from "./composition-html-editing-preview-images.server";
import { HTML_EDITING_PREVIEW_FONT_POLICY } from "./composition-html-editing-preview-fonts.server";

export const HTML_EDITING_PREVIEW_RESOURCE_POLICY = Object.freeze({
  totalBytes: HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES,
  maximumResources: HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS + CONFORMANCE_FONT_BINDING_LIMITS.maximumFonts,
  preparationTimeoutMs: 180_000,
});
export type HtmlEditingPreviewInventoryResource = {
  localPath: string; kind: "MEDIA" | "FONT"; identity: HtmlEditingPreviewStorageIdentity;
};
export class HtmlEditingPreviewInventoryError extends Error {
  constructor() { super("HTML_EDITING_PREVIEW_INVENTORY_INVALID"); this.name = "HtmlEditingPreviewInventoryError"; }
}

/** Pure preflight over independently authorized records. A fingerprint pins
 * identity for rechecks; it never authenticates actor, tenant or delivery. */
export function buildCompositionHtmlEditingPreviewInventory(input: {
  document: CompositionEditorDocument; htmlImages: unknown; nativeAssets: unknown;
  nativeDeckPublicUrls: Map<string, string>; fonts: OrganizationFontRecord[];
}) {
  try {
    const document = compositionEditorDocumentSchema.parse(input.document);
    const images = htmlEditingImageIdentitiesSchema.parse(input.htmlImages);
    const nativeAssets = hyperframesAssetManifestSchema.parse(input.nativeAssets);
    if (new Set(nativeAssets.map(asset => asset.productionAssetId)).size !== nativeAssets.length) throw new Error();
    if (images.reduce((total, image) => total + image.fileSizeBytes, 0) > HTML_EDITING_PREVIEW_IMAGE_POLICY.totalBytes
      || input.fonts.reduce((total, font) => total + font.fileSizeBytes, 0) > HTML_EDITING_PREVIEW_FONT_POLICY.totalBytes) throw new Error();
    const foreignOriginIds = new Set(document.clips.flatMap(clip =>
      clip.source.type === "ASSEMBLY_BRAND_ASSET" ? [clip.source.assemblyBrandAssetId]
        : clip.source.type === "SOUND_EFFECT_ASSET" ? [clip.source.soundEffectAssetId] : []));
    if (images.some(image => foreignOriginIds.has(image.productionAssetId))) throw new Error();
    const byId = new Map<string, HtmlEditingPreviewStorageIdentity>();
    for (const asset of [...nativeAssets, ...images]) {
      const { productionAssetId, ...fields } = asset;
      const identity = htmlEditingPreviewStorageIdentitySchema.parse(fields);
      if (identity.mimeType.startsWith("image/")) htmlEditingImageIdentitySchema.parse(asset);
      else if (!/^(audio|video)\//.test(identity.mimeType)) throw new Error();
      const prior = byId.get(productionAssetId);
      if (prior && identityKey(prior) !== identityKey(identity)) throw new Error();
      byId.set(productionAssetId, identity);
    }
    if (byId.size > HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS) throw new Error();
    const fontBindings = assertDocumentConformanceFontBindings(document, input.fonts.map(font => ({
      fontAssetId: font.id, family: font.family, checksumSha256: font.checksumSha256,
      fileSizeBytes: font.fileSizeBytes, mimeType: font.mimeType,
    })));
    const resources = new Map<string, HtmlEditingPreviewInventoryResource>();
    const assetUrls = new Map<string, string>();
    for (const [id, identity] of [...byId.entries()].sort(([first], [second]) => first.localeCompare(second))) {
      const localPath = `conformance-media/${id}`;
      assetUrls.set(id, localPath); resources.set(localPath, { localPath, kind: "MEDIA", identity });
    }
    const fonts = new Map<string, ReturnType<typeof compiledCompositionFont>>();
    for (const font of [...input.fonts].sort((first, second) => first.id.localeCompare(second.id))) {
      if (font.status !== "READY" || font.storageBucket !== ORGANIZATION_FONT_STORAGE_BUCKET) throw new Error();
      const identity = htmlEditingPreviewStorageIdentitySchema.parse({ checksum: font.checksumSha256,
        fileSizeBytes: font.fileSizeBytes, mimeType: font.mimeType, storageBucket: font.storageBucket, storagePath: font.storagePath });
      const localPath = compositionFontArchivePath(font);
      const existing = resources.get(localPath);
      // Content aliases may have independently authorized Storage locations.
      // Both records enter the fingerprint, but identical bytes download once.
      if (existing && (existing.identity.fileSizeBytes !== identity.fileSizeBytes || existing.identity.mimeType !== identity.mimeType)) throw new Error();
      if (!existing) resources.set(localPath, { localPath, kind: "FONT", identity });
      fonts.set(font.id, compiledCompositionFont(font, localPath));
    }
    const deckAssetUrls = new Map<string, string>();
    for (const [id, publicUrl] of input.nativeDeckPublicUrls) {
      z.string().uuid().parse(id); z.string().url().max(4096).parse(publicUrl);
      const localPath = assetUrls.get(id);
      if (!localPath || deckAssetUrls.has(publicUrl) && deckAssetUrls.get(publicUrl) !== localPath) throw new Error();
      deckAssetUrls.set(publicUrl, localPath);
    }
    const entries = [...resources.values()].sort((first, second) => first.localPath.localeCompare(second.localPath));
    const totalBytes = entries.reduce((total, resource) => total + resource.identity.fileSizeBytes, 0);
    if (entries.length > HTML_EDITING_PREVIEW_RESOURCE_POLICY.maximumResources || totalBytes > HTML_EDITING_PREVIEW_RESOURCE_POLICY.totalBytes) throw new Error();
    const fingerprint = createHash("sha256").update(JSON.stringify({
      resources: entries.map(resource => [resource.localPath, resource.kind, identityKey(resource.identity)]),
      fontBindings,
      fontRecords: input.fonts.map(font => [font.id, font.family, font.status, font.storageBucket, font.storagePath])
        .sort(([first], [second]) => String(first).localeCompare(String(second))),
      deckUrls: [...deckAssetUrls.entries()].sort(([first], [second]) => first.localeCompare(second)),
    })).digest("hex");
    return { entries, assetUrls, fonts, deckAssetUrls, totalBytes, fingerprint };
  } catch { throw new HtmlEditingPreviewInventoryError(); }
}

function identityKey(identity: HtmlEditingPreviewStorageIdentity) {
  return JSON.stringify([identity.checksum, identity.fileSizeBytes, identity.mimeType, identity.storageBucket, identity.storagePath]);
}

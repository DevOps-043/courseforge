import { z } from "zod";
import { hyperframesAssetManifestItemSchema } from "../hyperframes/hyperframes.types";
import { HYPERFRAMES_SOURCE_BUCKETS } from "../media-storage.config";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";

export const htmlEditingImageIdentitySchema = hyperframesAssetManifestItemSchema.extend({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  fileSizeBytes: z.number().int().positive().max(32 * 1024 * 1024),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  storageBucket: z.string().refine(bucket => HYPERFRAMES_SOURCE_BUCKETS.has(bucket)),
}).strict();
export const htmlEditingImageIdentitiesSchema = z.array(htmlEditingImageIdentitySchema)
  .max(HTML_EDITING_LIMITS.elements * HTML_EDITING_LIMITS.choices)
  .refine(images => new Set(images.map(image => image.productionAssetId)).size === images.length);
export type HtmlEditingImageIdentity = z.infer<typeof htmlEditingImageIdentitySchema>;
type FrozenBinding = { assetId: string; checksum: string; fileSizeBytes: number; mimeType: string;
  storageBucket: string; storagePath: string; localPath: string };

/** Compare independently authorized current records with byte-pinned snapshot
 * bindings. Neither list alone authorizes access or proves image decode safety. */
export function assertHtmlEditingImageIdentities(input: {
  usedAssetIds: readonly string[]; currentImages: unknown; frozenBindings: readonly FrozenBinding[];
}) {
  const parsed = htmlEditingImageIdentitiesSchema.safeParse(input.currentImages);
  if (!parsed.success) throw new Error("CONTROLLED_RENDER_HTML_IMAGE_IDENTITY_INVALID");
  const current = new Map(parsed.data.map(image => [image.productionAssetId, image]));
  const frozen = new Map(input.frozenBindings.map(binding => [binding.assetId, binding]));
  if (frozen.size !== input.frozenBindings.length || new Set(input.usedAssetIds).size !== input.usedAssetIds.length)
    throw new Error("CONTROLLED_RENDER_HTML_IMAGE_IDENTITY_INVALID");
  for (const id of input.usedAssetIds) {
    const actual = current.get(id), expected = frozen.get(id);
    if (!actual || !expected || expected.localPath !== `conformance-media/${id}`
      || actual.checksum !== expected.checksum || actual.fileSizeBytes !== expected.fileSizeBytes
      || actual.mimeType !== expected.mimeType || actual.storageBucket !== expected.storageBucket
      || actual.storagePath !== expected.storagePath) throw new Error("CONTROLLED_RENDER_HTML_IMAGE_IDENTITY_MISMATCH");
  }
}

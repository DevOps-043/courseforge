import { z } from "zod";

export const IMPORTED_SLIDE_ASSET_LIMITS = Object.freeze({ count: 64, bytes: 3_000_000, encodedCharacters: 4_000_000,
  pixels: 8192, totalPixels: 16_777_216, decodedFontBytes: 20_000_000, urlOverheadCharacters: 256 });
export const importedSlideAssetSchema = z.object({
  id: z.string().max(16).regex(/^asset-[1-9][0-9]*$/).refine(value => Number(value.slice(6)) <= IMPORTED_SLIDE_ASSET_LIMITS.count),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/svg+xml", "font/ttf", "font/woff", "font/woff2"]),
  base64: z.string().max(IMPORTED_SLIDE_ASSET_LIMITS.encodedCharacters).regex(/^[A-Za-z0-9+/]*={0,2}$/).refine(value => value.length % 4 === 0).optional(),
  byteLength: z.number().int().positive().max(IMPORTED_SLIDE_ASSET_LIMITS.bytes).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine(asset => asset.base64 !== undefined || asset.byteLength !== undefined && asset.sha256 !== undefined, "El recurso requiere contenido o manifiesto íntegro.");
export const importedSlideAssetsSchema = z.array(importedSlideAssetSchema).max(IMPORTED_SLIDE_ASSET_LIMITS.count).superRefine((assets, context) => {
  if (assets.reduce((sum, asset) => sum + (asset.base64?.length ?? 0), 0) > IMPORTED_SLIDE_ASSET_LIMITS.encodedCharacters
    || assets.reduce((sum, asset) => sum + (asset.byteLength ?? 0), 0) > IMPORTED_SLIDE_ASSET_LIMITS.bytes
    || new Set(assets.map(asset => asset.id)).size !== assets.length) {
    context.addIssue({ code: "custom", message: "Los recursos son excesivos o tienen identificadores repetidos." });
  }
});
export type ImportedSlideAsset = z.infer<typeof importedSlideAssetSchema>;

export const importedAssetReference = /^cf-asset:(asset-[1-9][0-9]*)$/;
export function importedAssetExtension(mime: ImportedSlideAsset["mimeType"]): string {
  return { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "font/ttf": "ttf", "font/woff": "woff", "font/woff2": "woff2" }[mime];
}

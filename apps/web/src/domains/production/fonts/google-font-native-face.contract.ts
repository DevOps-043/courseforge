import { z } from "zod";
import { googleFontBundleManifestSchema } from "./google-font-bundle.contract";
import { GOOGLE_FONT_PREPARATION_POLICY } from "./google-font-preparation-policy";

/** Immutable selection identity. Never a grant, URL or substitute uploaded ID. */
export const googleFontNativePinSchema = z.object({
  fontId: z.string().uuid(), bundleId: z.string().uuid(), candidateSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type GoogleFontNativePin = z.infer<typeof googleFontNativePinSchema>;
export const googleFontNativeFaceSchema = z.object({
  id: z.string().uuid(), organizationId: z.string().uuid(), admissionId: z.string().uuid(),
  pin: googleFontNativePinSchema, family: googleFontBundleManifestSchema.shape.family,
  face: googleFontBundleManifestSchema.shape.faces.element,
}).strict();
export const googleFontNativeFacesSchema = z.array(googleFontNativeFaceSchema).min(1)
  .max(GOOGLE_FONT_PREPARATION_POLICY.maximumFaces)
  .refine(faces => new Set(faces.map(face => face.id)).size === faces.length);
export type GoogleFontNativeFace = z.infer<typeof googleFontNativeFaceSchema>;
export const googleFontFaceBindingSchema = googleFontNativePinSchema.extend({
  admissionId: googleFontNativeFaceSchema.shape.admissionId,
  style: googleFontNativeFaceSchema.shape.face.shape.style,
  weight: googleFontNativeFaceSchema.shape.face.shape.weight,
  unicodeRange: googleFontNativeFaceSchema.shape.face.shape.unicodeRange,
}).strict();
export type GoogleFontFaceBinding = z.infer<typeof googleFontFaceBindingSchema>;
export function googleFontFaceBinding(face: GoogleFontNativeFace): GoogleFontFaceBinding {
  return googleFontFaceBindingSchema.parse({ ...face.pin, admissionId: face.admissionId,
    style: face.face.style, weight: face.face.weight, unicodeRange: face.face.unicodeRange });
}
export function googleFontNativeFile(native: GoogleFontNativeFace) {
  const { checksumSha256, fileSizeBytes, mimeType, embeddingCheck } = native.face;
  return { checksumSha256, fileSizeBytes, mimeType, embeddingCheck };
}

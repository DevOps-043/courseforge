import { z } from "zod";
import { GOOGLE_FONT_PREPARATION_POLICY, isGoogleFontUnicodeRange } from "./google-font-preparation-policy";
import { MAX_ORGANIZATION_FONT_BYTES } from "./organization-font-upload-policy.service";

export const GOOGLE_FONT_BUNDLE_FORMAT = "courseforge-google-font-candidate-bundle-v1";
export const GOOGLE_FONT_BUNDLE_TABLE = "organization_google_font_bundles";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.object({ checksumSha256: digest, fileSizeBytes: z.number().int().positive().max(MAX_ORGANIZATION_FONT_BYTES),
  mimeType: z.enum(["font/woff", "font/woff2", "font/ttf", "font/otf"]),
  embeddingCheck: z.enum(["ALLOWED", "UNVERIFIED_COMPRESSED"]),
}).strict();
const face = file.extend({ style: z.enum(["normal", "italic"]),
  weight: z.object({ minimum: z.number().int().min(1).max(1000), maximum: z.number().int().min(1).max(1000) }).strict()
    .refine(value => value.minimum <= value.maximum),
  unicodeRange: z.string().min(1).max(4096).refine(isGoogleFontUnicodeRange).nullable(),
}).strict();

export const googleFontBundleManifestSchema = z.object({ format: z.literal(GOOGLE_FONT_BUNDLE_FORMAT), source: z.literal("google"),
  family: z.string().trim().regex(/^[a-zA-Z0-9 ._-]+$/).min(1).max(120), stylesheetChecksumSha256: digest,
  files: z.array(file).min(1).max(GOOGLE_FONT_PREPARATION_POLICY.maximumFaces),
  faces: z.array(face).min(1).max(GOOGLE_FONT_PREPARATION_POLICY.maximumFaces),
}).strict().superRefine((manifest, context) => {
  const files = new Map(manifest.files.map(entry => [entry.checksumSha256, entry]));
  const faceIdentities = manifest.faces.map(entry => JSON.stringify([entry.style, entry.weight.minimum, entry.weight.maximum, entry.unicodeRange]));
  if (files.size !== manifest.files.length || new Set(faceIdentities).size !== faceIdentities.length
    || manifest.files.reduce((total, entry) => total + entry.fileSizeBytes, 0) > GOOGLE_FONT_PREPARATION_POLICY.totalFontBytes
    || manifest.faces.some(entry => JSON.stringify(files.get(entry.checksumSha256)) !== JSON.stringify({ checksumSha256: entry.checksumSha256,
      fileSizeBytes: entry.fileSizeBytes, mimeType: entry.mimeType, embeddingCheck: entry.embeddingCheck }))
    || manifest.files.some(entry => !manifest.faces.some(bound => bound.checksumSha256 === entry.checksumSha256))) {
    context.addIssue({ code: "custom", message: "GOOGLE_FONT_BUNDLE_BINDING_INVALID" });
  }
});
export type GoogleFontBundleManifest = z.infer<typeof googleFontBundleManifestSchema>;
export const googleFontMaterializationRequestSchema = z.object({ expectedCandidateSha256: digest }).strict();
export const googleFontBundleReceiptSchema = z.object({ bundleId: z.string().uuid(), candidateSha256: digest,
  status: z.literal("PREPARED"), renderEligible: z.literal(false), created: z.boolean(),
}).strict();
export type GoogleFontBundleReceipt = z.infer<typeof googleFontBundleReceiptSchema>;
export const googleFontPreparationDtoSchema = z.object({ fontId: z.string().uuid(), source: z.literal("google"), family: z.string().min(1).max(120),
  candidateSha256: digest, stylesheetChecksumSha256: digest, totalBytes: z.number().int().positive().max(GOOGLE_FONT_PREPARATION_POLICY.totalFontBytes),
  uniqueFiles: z.number().int().min(1).max(GOOGLE_FONT_PREPARATION_POLICY.maximumFaces),
  faces: z.array(face).min(1).max(GOOGLE_FONT_PREPARATION_POLICY.maximumFaces),
  scope: z.literal("STRUCTURAL_CANDIDATE_BYTES_NOT_NATIVE_AUTHORITY"), renderEligible: z.literal(false),
  status: z.literal("NATIVE_BUNDLE_INTEGRATION_REQUIRED"),
}).strict();
export type GoogleFontPreparationDto = z.infer<typeof googleFontPreparationDtoSchema>;

export function googleFontBundleStoragePath(organizationId: string, candidateSha256: string, font: GoogleFontBundleManifest["files"][number]) {
  z.string().uuid().parse(organizationId); digest.parse(candidateSha256); file.parse(font);
  return `${organizationId}/google-candidates/${candidateSha256}/${font.checksumSha256}.${font.mimeType.slice(5)}`;
}

import { z } from "zod";
import { GOOGLE_FONT_PREPARATION_POLICY } from "./google-font-preparation-policy";

export const GOOGLE_FONT_ADMISSION_FORMAT = "courseforge-decoded-google-font-bundle-v1";
export const GOOGLE_FONT_ADMISSION_TABLE = "organization_google_font_admissions";
export const GOOGLE_FONT_FACE_TABLE = "organization_google_font_faces";
export const googleFontAdmissionRequestSchema = z.object({ admit: z.literal(true),
  expectedCandidateSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const googleFontAdmissionReceiptSchema = z.object({
  admissionId: z.string().uuid(), bundleId: z.string().uuid(), fontId: z.string().uuid(),
  candidateSha256: z.string().regex(/^[a-f0-9]{64}$/), status: z.literal("READY"),
  faceIds: z.array(z.string().uuid()).min(1).max(GOOGLE_FONT_PREPARATION_POLICY.maximumFaces)
    .refine(ids => new Set(ids).size === ids.length), created: z.boolean(),
  scope: z.literal("DECODED_FONT_FILES_NOT_RENDER_ATTESTATION"),
}).strict();
export type GoogleFontAdmissionReceipt = z.infer<typeof googleFontAdmissionReceiptSchema>;

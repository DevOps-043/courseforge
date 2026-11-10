import { z } from "zod";
import { COURSE_SOURCE_FORMATS, COURSE_SOURCE_LIMITS } from "./course-source-policy";

const safeFilename = z.string().trim().min(1).max(255)
  .refine((name) => !/[\\/\x00-\x1f\x7f]/.test(name), "Nombre de archivo inválido.");

export const createSourceDraftSchema = z.object({
  idempotencyKey: z.uuid(),
  title: z.string().trim().min(1).max(300),
}).strict();

export const reserveSourceUploadSchema = z.object({
  idempotencyKey: z.uuid(),
  filename: safeFilename,
  mimeType: z.enum(Object.values(COURSE_SOURCE_FORMATS)),
  sizeBytes: z.number().int().positive().max(COURSE_SOURCE_LIMITS.fileBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  supersedesId: z.uuid().optional(),
}).strict().superRefine((file, context) => {
  const extension = file.filename.split(".").pop()?.toLowerCase();
  if (!extension || COURSE_SOURCE_FORMATS[extension as keyof typeof COURSE_SOURCE_FORMATS] !== file.mimeType) {
    context.addIssue({ code: "custom", message: "El nombre y el tipo de archivo no corresponden.", path: ["filename"] });
  }
});

export const confirmSourceUploadSchema = z.object({ documentId: z.uuid() }).strict();
export const sourcePageSchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(COURSE_SOURCE_LIMITS.maxPageSize).default(COURSE_SOURCE_LIMITS.pageSize),
}).strict();

export type CreateSourceDraft = z.infer<typeof createSourceDraftSchema>;
export type ReserveSourceUpload = z.infer<typeof reserveSourceUploadSchema>;

export const courseSourceDocumentSchema = z.object({
  id: z.uuid(), artifact_id: z.uuid(), organization_id: z.uuid(), created_by: z.uuid(),
  request_key: z.uuid(), filename: z.string(), mime_type: z.string(), size_bytes: z.number(),
  expected_sha256: z.string(), content_sha256: z.string().nullable(), storage_path: z.string(),
  status: z.enum(["RESERVED", "UPLOADED", "PROCESSING", "READY", "FAILED", "RETIRED"]),
  expires_at: z.string(), created_at: z.string(), uploaded_at: z.string().nullable(),
  supersedes_id: z.uuid().nullable().optional(),
  diagnostic_code: z.string().nullable().optional(),
  extraction_attempts: z.number().int().nonnegative().optional(),
  extraction_text_limit: z.number().int().positive().nullable().optional(),
});
export type CourseSourceDocument = z.infer<typeof courseSourceDocumentSchema>;

export function publicSourceDocument(document: CourseSourceDocument) {
  return {
    id: document.id, filename: document.filename, mimeType: document.mime_type,
    sizeBytes: document.size_bytes, status: document.status,
    createdAt: document.created_at, uploadedAt: document.uploaded_at,
    expiresAt: document.expires_at,
    supersedesId: document.supersedes_id || null,
    diagnosticCode: document.diagnostic_code ?? null,
    extractionTextLimit: document.extraction_text_limit ?? null,
    canRetryExtraction: (document.extraction_attempts ?? 0) < 3 ||
      (document.status === "FAILED" && (
        (document.extraction_attempts === 3 && document.diagnostic_code === "EXTRACTION_FAILED") ||
        (document.diagnostic_code === "TEXT_LIMIT" &&
          (document.extraction_text_limit ?? 0) < COURSE_SOURCE_LIMITS.activeTextCharacters)
      )),
  };
}

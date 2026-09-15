import { z } from "zod";

export const SYLLABUS_SOURCE_DOCUMENT_MAX_FILES = 8;
export const SYLLABUS_SOURCE_DOCUMENT_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
export const SYLLABUS_SOURCE_DOCUMENT_MAX_CHARACTERS = 40_000;
export const SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_CHARACTERS = 120_000;

export const SYLLABUS_SOURCE_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
] as const;

export const syllabusSourceDocumentSchema = z.object({
  characterCount: z.number().int().positive().max(SYLLABUS_SOURCE_DOCUMENT_MAX_CHARACTERS),
  fileId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(SYLLABUS_SOURCE_DOCUMENT_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(SYLLABUS_SOURCE_DOCUMENT_MAX_FILE_BYTES),
  text: z.string().trim().min(1).max(SYLLABUS_SOURCE_DOCUMENT_MAX_CHARACTERS),
}).strict();

export const syllabusSourceDocumentsSchema = z
  .array(syllabusSourceDocumentSchema)
  .max(SYLLABUS_SOURCE_DOCUMENT_MAX_FILES)
  .superRefine((documents, context) => {
    const totalBytes = documents.reduce(
      (total, document) => total + document.sizeBytes,
      0,
    );
    if (totalBytes > SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_BYTES) {
      context.addIssue({
        code: "custom",
        message: "Los documentos exceden el límite total de 40 MB.",
      });
    }

    const totalCharacters = documents.reduce(
      (total, document) => total + document.text.length,
      0,
    );
    if (totalCharacters > SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_CHARACTERS) {
      context.addIssue({
        code: "custom",
        message: "El contenido total de los documentos excede el límite permitido.",
      });
    }
  });

export type SyllabusSourceDocument = z.infer<typeof syllabusSourceDocumentSchema>;

export function isSupportedSyllabusDocument(file: Pick<File, "name" | "type">) {
  const extension = file.name.toLowerCase().split(".").pop();
  return (
    SYLLABUS_SOURCE_DOCUMENT_MIME_TYPES.includes(
      file.type as (typeof SYLLABUS_SOURCE_DOCUMENT_MIME_TYPES)[number],
    ) ||
    extension === "pdf" ||
    extension === "docx" ||
    extension === "pptx" ||
    extension === "txt"
  );
}

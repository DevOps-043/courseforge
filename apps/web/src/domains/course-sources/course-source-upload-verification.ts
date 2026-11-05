import { createHash } from "node:crypto";
import JSZip from "jszip";
import { COURSE_SOURCE_FORMATS, COURSE_SOURCE_LIMITS } from "./course-source-policy";
import { CourseSourceError } from "./course-source-error";
import type { CourseSourceDocument } from "./course-source.schema";
import { verifyOfficeDirectoryHeader } from "./course-source-office-header";

/** Verifica recepción; la extracción y la aptitud curricular pertenecen a F2/F3. */
export async function verifySourceUpload(document: CourseSourceDocument, bytes: Uint8Array) {
  if (bytes.byteLength !== document.size_bytes || bytes.byteLength > COURSE_SOURCE_LIMITS.fileBytes) {
    throw new CourseSourceError(413, "El tamaño real del archivo no coincide con la reserva.");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== document.expected_sha256) throw new CourseSourceError(409, "El archivo recibido no coincide con el hash reservado.");
  if (document.mime_type === COURSE_SOURCE_FORMATS.pdf) {
    if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") invalidFormat();
  } else if (document.mime_type === COURSE_SOURCE_FORMATS.txt) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes("\0") || !text.trim()) invalidFormat();
    } catch { invalidFormat(); }
  } else if (document.mime_type === COURSE_SOURCE_FORMATS.docx || document.mime_type === COURSE_SOURCE_FORMATS.pptx) {
    try {
      verifyOfficeDirectoryHeader(bytes);
      const archive = await JSZip.loadAsync(bytes);
      const entries = Object.keys(archive.files);
      if (entries.length > COURSE_SOURCE_LIMITS.officeEntries || !archive.file("[Content_Types].xml")) invalidFormat();
      const hasContent = document.mime_type === COURSE_SOURCE_FORMATS.docx
        ? archive.file("word/document.xml") !== null
        : archive.file(/^ppt\/slides\/slide\d+\.xml$/).length > 0;
      if (!hasContent) invalidFormat();
    } catch { invalidFormat(); }
  } else { invalidFormat(); }
  return { sha256, sizeBytes: bytes.byteLength };
}

function invalidFormat(): never { throw new CourseSourceError(415, "El contenido no corresponde a un archivo compatible."); }

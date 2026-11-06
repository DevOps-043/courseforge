import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractSyllabusSourceDocument } from "../syllabus/lib/syllabus-document-extractor";
import { CourseSourceRepository } from "./course-source.repository";
import { createSourceStorage } from "./course-source-storage";
import { verifySourceUpload } from "./course-source-upload-verification";
import { sourcePersistenceError } from "./course-source-error";

export function fragmentSourceText(text: string) {
  const fragments = [];
  for (let start = 0; start < text.length; start += 2000) {
    const content = text.slice(start, start + 2000);
    fragments.push({ ordinal: fragments.length, text: content,
      sha256: createHash("sha256").update(content).digest("hex"),
      locator: { characterStart: start, characterEnd: start + content.length } });
  }
  return fragments;
}

export async function extractCourseSource(admin: SupabaseClient, artifactId: string, documentId: string, organizationId: string) {
  const document = await new CourseSourceRepository(admin, { organizationId, userId: "" }).get(artifactId, documentId);
  if (!document) throw new Error("Documento no autorizado.");
  const base = { p_document: documentId, p_artifact: artifactId, p_organization: organizationId };
  const reservation = await admin.rpc("process_course_source_document", { ...base, p_action: "reserve", p_token: null });
  if (reservation.error) sourcePersistenceError(reservation.error);
  if (!reservation.data) return;
  const token = reservation.data as string;
  try {
    const bytes = await createSourceStorage(admin).read(document.storage_path, document.size_bytes);
    await verifySourceUpload(document, bytes);
    const extracted = await extractSyllabusSourceDocument(new File([Uint8Array.from(bytes).buffer], document.filename, { type: document.mime_type }));
    const result = await admin.rpc("process_course_source_document", { ...base, p_action: "complete", p_token: token,
      p_fragments: fragmentSourceText(extracted.text) });
    if (result.error) sourcePersistenceError(result.error);
  } catch {
    await admin.rpc("process_course_source_document", { ...base, p_action: "fail", p_token: token });
    throw new Error("No se pudo extraer el documento. Revisa el formato, el límite de texto y si necesita OCR.");
  }
}

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractSyllabusSourceDocument, SyllabusSourceTextError } from "../syllabus/lib/syllabus-document-extractor";
import { CourseSourceRepository } from "./course-source.repository";
import { createSourceStorage } from "./course-source-storage";
import { verifySourceUpload } from "./course-source-upload-verification";
import { sourcePersistenceError } from "./course-source-error";

export function fragmentSourceText(text: string) {
  const fragmentSize = 2000;
  const fragments = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + fragmentSize, text.length);
    const nextUnit = text.charCodeAt(end);
    if (nextUnit >= 0xdc00 && nextUnit <= 0xdfff) end -= 1;
    const content = text.slice(start, end);
    fragments.push({ ordinal: fragments.length, text: content,
      sha256: createHash("sha256").update(content).digest("hex"),
      locator: { characterStart: start, characterEnd: end } });
    start = end;
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
  let diagnosticCode = "SOURCE_READ_FAILED";
  try {
    const bytes = await createSourceStorage(admin).read(document.storage_path, document.size_bytes);
    diagnosticCode = "SOURCE_FORMAT_INVALID";
    await verifySourceUpload(document, bytes);
    const blob = new Blob([Uint8Array.from(bytes).buffer]);
    const extracted = await extractSyllabusSourceDocument({
      name: document.filename, type: document.mime_type, size: blob.size,
      arrayBuffer: () => blob.arrayBuffer(),
    });
    diagnosticCode = "SOURCE_PERSIST_FAILED";
    const result = await admin.rpc("process_course_source_document", { ...base, p_action: "complete", p_token: token,
      p_fragments: fragmentSourceText(extracted.text) });
    if (result.error) sourcePersistenceError(result.error);
  } catch (error) {
    if (error instanceof SyllabusSourceTextError) diagnosticCode = error.reason;
    const failure = await admin.rpc("process_course_source_document", {
      ...base, p_action: "fail", p_token: token, p_fragments: { diagnosticCode },
    });
    console.warn("[Fuentes] Falló la extracción documental", { artifactId, documentId, diagnosticCode, estadoGuardado: !failure.error });
    throw new Error("No se pudo completar la extracción documental.");
  }
}

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractSyllabusSourceDocument, SyllabusSourceTextError } from "../syllabus/lib/syllabus-document-extractor";
import { CourseSourceRepository } from "./course-source.repository";
import { createSourceStorage } from "./course-source-storage";
import { verifySourceUpload } from "./course-source-upload-verification";
import { sourcePersistenceError } from "./course-source-error";
import { COURSE_SOURCE_LIMITS } from "./course-source-policy";

export function* fragmentSourceText(text: string) {
  const fragmentSize = 2000;
  let ordinal = 0;
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + fragmentSize, text.length);
    const nextUnit = text.charCodeAt(end);
    if (nextUnit >= 0xdc00 && nextUnit <= 0xdfff) end -= 1;
    const content = text.slice(start, end);
    yield { ordinal: ordinal++, text: content,
      sha256: createHash("sha256").update(content).digest("hex"),
      locator: { characterStart: start, characterEnd: end } };
    start = end;
  }
}

function* sourceExtractionBatches(text: string) {
  const fragments = fragmentSourceText(text);
  while (true) {
    const batch = [];
    for (let index = 0; index < COURSE_SOURCE_LIMITS.extractionBatchFragments; index++) {
      const fragment = fragments.next();
      if (fragment.done) break;
      batch.push(fragment.value);
    }
    if (!batch.length) return;
    yield batch;
  }
}

export async function extractCourseSource(admin: SupabaseClient, artifactId: string, documentId: string, organizationId: string) {
  const document = await new CourseSourceRepository(admin, { organizationId, userId: "" }).get(artifactId, documentId);
  if (!document) throw new Error("Documento no autorizado.");
  const base = { p_document: documentId, p_artifact: artifactId, p_organization: organizationId };
  const textLimitUnits = COURSE_SOURCE_LIMITS.activeTextCharacters;
  const reservation = await admin.rpc("process_course_source_document", {
    ...base, p_action: "reserve", p_token: null, p_fragments: { textLimitUnits },
  });
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
    }, { maxCharacters: textLimitUnits });
    diagnosticCode = "SOURCE_PERSIST_FAILED";
    let fragmentCount = 0;
    for (const batch of sourceExtractionBatches(extracted.text)) {
      const staged = await admin.rpc("stage_course_source_extraction", { ...base, p_action: "append", p_token: token,
        p_fragments: batch });
      if (staged.error) sourcePersistenceError(staged.error);
      fragmentCount += batch.length;
    }
    const result = await admin.rpc("stage_course_source_extraction", { ...base, p_action: "publish", p_token: token,
      p_count: fragmentCount, p_characters: extracted.characterCount });
    if (result.error) {
      if (result.error.message === "SOURCE_COURSE_TEXT_LIMIT") diagnosticCode = "COURSE_TEXT_LIMIT";
      sourcePersistenceError(result.error);
    }
  } catch (error) {
    if (error instanceof SyllabusSourceTextError) diagnosticCode = error.reason;
    const failure = await admin.rpc("process_course_source_document", {
      ...base, p_action: "fail", p_token: token, p_fragments: { diagnosticCode },
    });
    console.warn("[Fuentes] Falló la extracción documental", {
      artifactId, documentId, diagnosticCode, estadoGuardado: !failure.error, textLimitUnits,
      ...(error instanceof SyllabusSourceTextError && error.measuredUnits !== undefined
        ? { measuredUnits: error.measuredUnits } : {}),
    });
    throw new Error("No se pudo completar la extracción documental.");
  }
}

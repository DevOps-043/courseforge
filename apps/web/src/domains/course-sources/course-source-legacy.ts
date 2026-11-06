import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  COURSE_SOURCE_BUCKET,
  COURSE_SOURCE_LIMITS,
} from "./course-source-policy";
import {
  CourseSourceError,
  sourcePersistenceError,
} from "./course-source-error";
import {
  CourseSourceRepository,
  type SourceActor,
} from "./course-source.repository";
import { CourseSourceService } from "./course-source.service";
import { createSourceStorage } from "./course-source-storage";
import { publicSourceDocument } from "./course-source.schema";

export const legacySourceImportSchema = z
  .object({
    kind: z.enum(["SYLLABUS_DOCUMENT", "CURATION_PDF"]),
    sourceId: z.uuid(),
    idempotencyKey: z.uuid(),
  })
  .strict();
export async function listLegacySources(
  admin: SupabaseClient,
  artifactId: string,
) {
  const [syllabus, pdfs] = await Promise.all([
    admin
      .from("syllabus_source_documents")
      .select("id,filename")
      .eq("artifact_id", artifactId)
      .limit(51),
    admin
      .from("curation_rows")
      .select("id,file_name,curation!inner(artifact_id)")
      .eq("curation.artifact_id", artifactId)
      .eq("source_kind", "pdf")
      .limit(51),
  ]);
  for (const result of [syllabus, pdfs])
    if (result.error && !["42P01", "PGRST205"].includes(result.error.code))
      sourcePersistenceError(result.error);
  if ((syllabus.data?.length || 0) > 50 || (pdfs.data?.length || 0) > 50)
    throw new CourseSourceError(
      413,
      "Hay más de 50 fuentes históricas por origen. Reduce la selección antes de importar.",
    );
  return {
    sources: [
      ...(syllabus.data || []).map((row) => ({
        id: row.id,
        kind: "SYLLABUS_DOCUMENT",
        title: row.filename,
        diagnostic:
          "Se conserva el texto extraído, pero no el binario original. Se creará un TXT derivado con procedencia.",
      })),
      ...(pdfs.data || []).map((row) => ({
        id: row.id,
        kind: "CURATION_PDF",
        title: row.file_name || "PDF histórico",
        diagnostic:
          "Se copiará el original privado si está disponible y cumple el límite actual de 15 MB.",
      })),
    ],
  };
}
export async function importLegacySource(
  admin: SupabaseClient,
  artifactId: string,
  actor: SourceActor,
  input: z.infer<typeof legacySourceImportSchema>,
) {
  const existing = await admin
    .from("course_source_legacy_imports")
    .select("document_id,original_available")
    .eq("artifact_id", artifactId)
    .eq("origin_kind", input.kind)
    .eq("origin_id", input.sourceId)
    .maybeSingle();
  if (existing.error) sourcePersistenceError(existing.error);
  const repository = new CourseSourceRepository(admin, actor);
  if (existing.data) {
    const document = await repository.get(
      artifactId,
      existing.data.document_id,
    );
    if (!document)
      throw new CourseSourceError(
        409,
        "La importación necesita conciliación antes de repetirla.",
      );
    return {
      document: publicSourceDocument(document),
      originalAvailable: existing.data.original_available,
    };
  }
  let bytes: Uint8Array;
  let filename: string;
  let mimeType: "text/plain" | "application/pdf";
  let originHash: string;
  if (input.kind === "SYLLABUS_DOCUMENT") {
    const { data: source, error } = await admin
      .from("syllabus_source_documents")
      .select("filename,extracted_text,content_sha256")
      .eq("artifact_id", artifactId)
      .eq("id", input.sourceId)
      .maybeSingle();
    if (error) sourcePersistenceError(error);
    if (!source)
      throw new CourseSourceError(
        404,
        "Documento histórico no encontrado para este curso.",
      );
    if (!source.extracted_text?.trim() || source.extracted_text.length > 40_000)
      throw new CourseSourceError(
        409,
        "El texto histórico está ausente o excede el límite. Vuelve a cargar el original.",
      );
    bytes = new TextEncoder().encode(source.extracted_text);
    mimeType = "text/plain";
    originHash = source.content_sha256;
    filename = `${source.filename.replace(/\.[^.]+$/, "").slice(0, 210)}-texto-importado.txt`;
  } else {
    const { data: source, error } = await admin
      .from("curation_rows")
      .select(
        "storage_bucket,storage_path,file_name,content_sha256,curation!inner(artifact_id)",
      )
      .eq("curation.artifact_id", artifactId)
      .eq("source_kind", "pdf")
      .eq("id", input.sourceId)
      .maybeSingle();
    if (error) sourcePersistenceError(error);
    if (
      !source ||
      source.storage_bucket !== "curation-sources" ||
      !source.storage_path?.startsWith(
        `organizations/${actor.organizationId}/curation-sources/${artifactId}/`,
      ) ||
      source.storage_path.includes("..") ||
      /[%\\?#\u0000-\u001f]/.test(source.storage_path)
    )
      throw new CourseSourceError(
        404,
        "Original histórico no disponible para este curso. Vuelve a cargarlo.",
      );
    const bucket = admin.storage.from("curation-sources");
    const info = await bucket.info(source.storage_path);
    if (info.error || !info.data)
      throw new CourseSourceError(
        409,
        "El original histórico está ausente. Vuelve a cargar el PDF.",
      );
    if (
      typeof info.data.size !== "number" ||
      info.data.size < 1 ||
      info.data.size > COURSE_SOURCE_LIMITS.fileBytes
    )
      throw new CourseSourceError(
        413,
        "El PDF histórico no tiene un tamaño válido de hasta 15 MB. Divide o vuelve a cargar el original.",
      );
    const downloaded = await bucket.download(source.storage_path);
    if (downloaded.error || !downloaded.data)
      throw new CourseSourceError(
        503,
        "No se pudo recuperar el original histórico.",
      );
    bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    mimeType = "application/pdf";
    originHash = source.content_sha256;
    if (bytes.length !== info.data.size)
      throw new CourseSourceError(
        409,
        "El original cambió durante su lectura.",
      );
    filename = source.file_name || "manual-importado.pdf";
  }
  filename = filename.replace(/[\u0000-\u001f\u007f/\\]/g, "_");
  const hash = sourceTextHashBytes(bytes);
  if (input.kind === "CURATION_PDF" && originHash && hash !== originHash)
    throw new CourseSourceError(
      409,
      "La integridad del PDF histórico no coincide. Vuelve a cargar el original.",
    );
  const reserved = await repository.reserve(artifactId, {
    idempotencyKey: input.idempotencyKey,
    filename,
    mimeType,
    sizeBytes: bytes.length,
    sha256: hash,
  });
  if (reserved.status === "RESERVED") {
    const uploaded = await admin.storage
      .from(COURSE_SOURCE_BUCKET)
      .upload(reserved.storage_path, Uint8Array.from(bytes).buffer, {
        contentType: mimeType,
        upsert: false,
      });
    if (
      uploaded.error &&
      !["409", "Duplicate"].includes(String(uploaded.error.statusCode))
    )
      throw new CourseSourceError(
        503,
        "No se pudo copiar la fuente privada. Reintenta con la misma clave.",
      );
    await new CourseSourceService(
      repository,
      createSourceStorage(admin),
      actor.userId,
    ).confirm(artifactId, reserved.id);
  }
  const linked = await admin.from("course_source_legacy_imports").insert({
    artifact_id: artifactId,
    document_id: reserved.id,
    origin_kind: input.kind,
    origin_id: input.sourceId,
    origin_hash: originHash,
    original_available: input.kind === "CURATION_PDF",
  });
  if (linked.error && linked.error.code !== "23505")
    sourcePersistenceError(linked.error);
  return {
    document: publicSourceDocument(
      (await repository.get(artifactId, reserved.id))!,
    ),
    originalAvailable: input.kind === "CURATION_PDF",
  };
}
function sourceTextHashBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

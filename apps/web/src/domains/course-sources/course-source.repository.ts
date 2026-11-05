import type { SupabaseClient } from "@supabase/supabase-js";
import { courseSourceDocumentSchema, type CreateSourceDraft, type ReserveSourceUpload } from "./course-source.schema";
import { sourcePersistenceError } from "./course-source-error";

export interface SourceActor { organizationId: string; userId: string }
const DOCUMENT_COLUMNS = "id,artifact_id,organization_id,created_by,request_key,filename,mime_type,size_bytes,expected_sha256,content_sha256,storage_path,status,expires_at,created_at,uploaded_at";

export class CourseSourceRepository {
  constructor(private readonly database: SupabaseClient, private readonly actor: SourceActor) {}

  async createDraft(input: CreateSourceDraft): Promise<string> {
    const { data, error } = await this.database.rpc("create_course_source_draft", {
      p_organization: this.actor.organizationId, p_actor: this.actor.userId,
      p_key: input.idempotencyKey, p_title: input.title,
    });
    if (error) sourcePersistenceError(error);
    if (typeof data !== "string") sourcePersistenceError({ message: "Respuesta inválida" });
    return data;
  }

  async reserve(artifactId: string, input: ReserveSourceUpload) {
    const { data, error } = await this.database.rpc("reserve_course_source_upload", {
      p_artifact: artifactId, p_organization: this.actor.organizationId, p_actor: this.actor.userId,
      p_key: input.idempotencyKey, p_filename: input.filename, p_mime: input.mimeType,
      p_bytes: input.sizeBytes, p_sha256: input.sha256,
    });
    if (error) sourcePersistenceError(error);
    return courseSourceDocumentSchema.parse(data);
  }

  async get(artifactId: string, documentId: string) {
    const { data, error } = await this.database.from("course_source_documents").select(DOCUMENT_COLUMNS)
      .eq("artifact_id", artifactId).eq("organization_id", this.actor.organizationId).eq("id", documentId).maybeSingle();
    if (error) sourcePersistenceError(error);
    return data ? courseSourceDocumentSchema.parse(data) : null;
  }

  async list(artifactId: string, offset: number, limit: number) {
    const { data, error } = await this.database.from("course_source_documents").select(DOCUMENT_COLUMNS)
      .eq("artifact_id", artifactId).eq("organization_id", this.actor.organizationId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit);
    if (error) sourcePersistenceError(error);
    const rows = (data || []).map((row) => courseSourceDocumentSchema.parse(row));
    return { documents: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }

  async confirm(artifactId: string, documentId: string, sha256: string, sizeBytes: number) {
    const { data, error } = await this.database.rpc("confirm_course_source_upload", {
      p_artifact: artifactId, p_organization: this.actor.organizationId, p_actor: this.actor.userId,
      p_document: documentId, p_sha256: sha256, p_bytes: sizeBytes,
    });
    if (error) sourcePersistenceError(error);
    return courseSourceDocumentSchema.parse(data);
  }
}

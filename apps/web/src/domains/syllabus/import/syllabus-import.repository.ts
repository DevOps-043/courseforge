import type { SupabaseClient } from "@supabase/supabase-js";
import {
  importOutlineSchema,
  SYLLABUS_IMPORT_POLICY,
  type SyllabusImportRecord,
} from "./syllabus-import.schema";
import {
  SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_BYTES,
  SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_CHARACTERS,
} from "../syllabus-source-documents";

export class SyllabusImportError extends Error {
  constructor(
    message: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}
export function isSyllabusImportEnabled(organizationId?: string | null) {
  if (process.env.PROVIDED_SYLLABUS_ENABLED !== "true") return false;
  const allowedOrganizations = (
    process.env.PROVIDED_SYLLABUS_ORGANIZATIONS || ""
  )
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return (
    !allowedOrganizations.length ||
    Boolean(organizationId && allowedOrganizations.includes(organizationId))
  );
}

export class SyllabusImportRepository {
  constructor(
    private readonly admin: SupabaseClient,
    readonly artifactId: string,
  ) {}

  async get(importId?: string): Promise<SyllabusImportRecord | null> {
    let query = this.admin
      .from("syllabus_imports")
      .select("*")
      .eq("artifact_id", this.artifactId);
    if (importId) query = query.eq("id", importId);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const entry = data as SyllabusImportRecord;
    if (
      entry.lease_expires_at &&
      Date.parse(entry.lease_expires_at) <= Date.now()
    ) {
      return this.transition(entry, "recover");
    }
    importOutlineSchema.parse(entry.candidate_outline);
    return entry;
  }

  async documents(ids: string[]) {
    if (new Set(ids).size !== ids.length)
      throw new SyllabusImportError("Selecciona documentos diferentes.", 400);
    const { data, error } = await this.admin
      .from("syllabus_source_documents")
      .select("id, filename, extracted_text, content_sha256,size_bytes")
      .eq("artifact_id", this.artifactId)
      .in("id", ids);
    if (error) throw error;
    if (!data || data.length !== ids.length)
      throw new SyllabusImportError(
        "Documento no encontrado para este artefacto.",
        404,
      );
    if (
      data.reduce(
        (total, document) => total + document.extracted_text.length,
        0,
      ) > SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_CHARACTERS ||
      data.reduce((total, document) => total + document.size_bytes, 0) >
        SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_BYTES
    ) {
      throw new SyllabusImportError(
        "Los documentos seleccionados exceden los límites totales de contenido o tamaño.",
        413,
      );
    }
    return data as Array<{
      id: string;
      filename: string;
      extracted_text: string;
      content_sha256: string;
    }>;
  }

  async start(
    primaryId: string,
    supportIds: string[],
    key: string,
    actorId: string,
  ) {
    await this.documents([primaryId, ...supportIds]);
    const { data: existing, error: lookupError } = await this.admin
      .from("syllabus_imports")
      .select("*")
      .eq("artifact_id", this.artifactId)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      if (
        existing.primary_document_id !== primaryId ||
        JSON.stringify(existing.support_document_ids) !==
          JSON.stringify(supportIds)
      ) {
        throw new SyllabusImportError(
          "La clave de operación ya corresponde a otros documentos.",
        );
      }
      return { entry: existing as SyllabusImportRecord, created: false };
    }
    const { data: syllabus, error: syllabusError } = await this.admin
      .from("syllabus")
      .select("content_version,state")
      .eq("artifact_id", this.artifactId)
      .maybeSingle();
    if (syllabusError) throw syllabusError;
    if (syllabus?.state === "STEP_GENERATING")
      throw new SyllabusImportError(
        "Espera a que termine la generación en curso.",
      );
    const latest = await this.get();
    if (latest?.lease_expires_at)
      throw new SyllabusImportError(
        "Ya hay una operación de temario en curso.",
      );
    const { data, error } = await this.admin
      .from("syllabus_imports")
      .insert({
        artifact_id: this.artifactId,
        created_by: actorId,
        primary_document_id: primaryId,
        support_document_ids: supportIds,
        idempotency_key: key,
        operation: "parse",
        lease_expires_at: new Date(
          Date.now() + SYLLABUS_IMPORT_POLICY.leaseMinutes * 60_000,
        ).toISOString(),
        source_syllabus_version: syllabus?.content_version || 0,
      })
      .select("*")
      .single();
    if (error?.code === "23505")
      throw new SyllabusImportError(
        "Otra operación se inició al mismo tiempo. Actualiza antes de reintentar.",
      );
    if (error?.message?.includes("SYLLABUS_IMPORT_QUOTA"))
      throw new SyllabusImportError(
        "Este artefacto alcanzó el límite diario de importaciones. Continúa con una importación existente o intenta mañana.",
        429,
      );
    if (error) throw error;
    return { entry: data as SyllabusImportRecord, created: true };
  }

  async transition(
    entry: SyllabusImportRecord,
    action: string,
    payload: Record<string, unknown> = {},
    actorId?: string,
  ): Promise<SyllabusImportRecord> {
    const { data, error } = await this.admin.rpc("transition_syllabus_import", {
      p_artifact_id: this.artifactId,
      p_import_id: entry.id,
      p_revision: entry.revision,
      p_action: action,
      p_payload: payload,
      p_actor_id: actorId || null,
    });
    if (error) {
      if (error.message?.includes("SYLLABUS_IMPORT_"))
        throw new SyllabusImportError(
          "La operación perdió su reserva o cambió la revisión. Actualiza el temario antes de continuar.",
        );
      throw error;
    }
    return data as SyllabusImportRecord;
  }
}

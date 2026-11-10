"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { REVIEWER_ROLE_SET } from "@/lib/pipeline-constants";
import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { AuthIdentityLookupError } from "@/lib/server/auth-identity-error";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { resolveActiveTenantContext, TenantContextLookupError } from "@/lib/server/tenant-context";

const confirmationSchema = z.string().regex(/^[a-f0-9]{64}$/);
const previewSchema = z.object({
  confirmation: confirmationSchema,
  documents: z.array(z.object({ id: z.uuid(), filename: z.string(), status: z.string(), kind: z.enum(["original", "temario"]) })),
});

type Failure = { success: false; error: string; refresh?: boolean };
type Success<T> = { success: true } & T;
type ArtifactScope = { p_artifact_id: string; p_organization_id: string };

async function withDeletionAccess<T>(
  artifactId: string,
  operation: (admin: SupabaseClient, scope: ArtifactScope) => Promise<Success<T> | Failure>,
  failureMessage: string,
): Promise<Success<T> | Failure> {
  if (!z.uuid().safeParse(artifactId).success) return { success: false, error: "El identificador del artefacto no es válido." };

  const reference = resolveCorrelationId();
  const logger = createOperationalLogger("artefactos.eliminacion", { correlationId: reference });
  try {
    const tenant = await resolveActiveTenantContext();
    if (!tenant?.platformRole || !REVIEWER_ROLE_SET.has(tenant.platformRole)) {
      return { success: false, error: "Necesitas una sesión activa con rol de Arquitecto o Administrador en esta organización." };
    }
    return await operation(getServiceRoleClient(), { p_artifact_id: artifactId, p_organization_id: tenant.organizationId });
  } catch (error) {
    if (error instanceof AuthIdentityLookupError || error instanceof TenantContextLookupError) {
      return { success: false, error: "No se pudo verificar temporalmente tu acceso. Intenta de nuevo." };
    }
    const code = z.object({ code: z.string() }).safeParse(error).data?.code;
    logger.warn("artefacto.eliminacion_sin_confirmar", { codigo: code });
    if (code === "23503") {
      return { success: false, error: `El artefacto tiene datos vinculados que impiden eliminarlo. Referencia: ${reference}.` };
    }
    if (code === "55P03" || code === "40P01") {
      return { success: false, error: "El artefacto está en uso. Intenta de nuevo cuando termine la operación en curso." };
    }
    return { success: false, error: `${failureMessage} Referencia: ${reference}.` };
  }
}

export async function previewArtifactDeletionAction(artifactId: string) {
  return withDeletionAccess<{ preview: z.infer<typeof previewSchema> }>(artifactId, async (admin, scope) => {
    const { data, error } = await admin.rpc("preview_artifact_deletion", scope);
    if (error) throw error;
    if (data === null) return { success: false, error: "El artefacto no está disponible en esta organización." };
    return { success: true, preview: previewSchema.parse(data) };
  }, "No se pudieron consultar los documentos que se eliminarán.");
}

export async function downloadSyllabusDeletionDocumentAction(artifactId: string, documentId: string) {
  if (!z.uuid().safeParse(documentId).success) return { success: false as const, error: "El identificador del documento no es válido." };
  return withDeletionAccess<{ filename: string; text: string }>(artifactId, async (admin, scope) => {
    const { data, error } = await admin.from("syllabus_source_documents")
      .select("filename,extracted_text,artifacts!inner(organization_id)")
      .eq("id", documentId).eq("artifact_id", scope.p_artifact_id)
      .eq("artifacts.organization_id", scope.p_organization_id).maybeSingle();
    if (error) throw error;
    if (!data) return { success: false, error: "Documento no disponible para este artefacto." };
    return { success: true, filename: `${data.filename}.txt`, text: data.extracted_text };
  }, "No se pudo descargar el texto del temario.");
}

export async function deleteArtifactAction(artifactId: string, confirmation: string) {
  if (!confirmationSchema.safeParse(confirmation).success) {
    return { success: false as const, error: "Revisa los documentos antes de confirmar la eliminación.", refresh: true };
  }
  return withDeletionAccess(artifactId, async (admin, scope) => {
    const { data, error } = await admin.rpc("confirm_artifact_deletion", { ...scope, p_confirmation: confirmation });
    if (error) throw error;
    if (data === "DELETED") return { success: true };
    if (data === "NOT_FOUND") return { success: false, error: "El artefacto no está disponible en esta organización. Actualiza la lista." };
    if (data === "MANIFEST_CHANGED") {
      return { success: false, error: "Los documentos cambiaron. Vuelve a revisar la lista antes de confirmar.", refresh: true };
    }
    throw new Error("Respuesta de eliminación inesperada.");
  }, "No se pudo confirmar la eliminación. Actualiza la lista antes de reintentar.");
}

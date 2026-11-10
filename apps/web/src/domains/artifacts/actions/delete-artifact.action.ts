"use server";

import { z } from "zod";
import { REVIEWER_ROLE_SET } from "@/lib/pipeline-constants";
import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { AuthIdentityLookupError } from "@/lib/server/auth-identity-error";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { resolveActiveTenantContext, TenantContextLookupError } from "@/lib/server/tenant-context";

export async function deleteArtifactAction(artifactId: string): Promise<
  { success: true } | { success: false; error: string }
> {
  if (!z.uuid().safeParse(artifactId).success) {
    return { success: false, error: "El identificador del artefacto no es válido." };
  }

  const reference = resolveCorrelationId();
  const logger = createOperationalLogger("artefactos.eliminacion", { correlationId: reference });
  try {
    const tenant = await resolveActiveTenantContext();
    if (!tenant?.platformRole || !REVIEWER_ROLE_SET.has(tenant.platformRole)) {
      return { success: false, error: "Necesitas una sesión activa con rol de Arquitecto o Administrador en esta organización." };
    }

    const { data, error } = await getServiceRoleClient().rpc("delete_artifact_for_organization", {
      p_artifact_id: artifactId,
      p_organization_id: tenant.organizationId,
    });
    if (error) {
      if (error.code === "23503") {
        logger.warn("artefacto.eliminacion_dependencia", { codigo: error.code });
        return { success: false, error: `El artefacto tiene datos vinculados que impiden eliminarlo. Referencia: ${reference}.` };
      }
      if (error.code === "55P03" || error.code === "40P01") {
        return { success: false, error: "El artefacto está en uso. Intenta eliminarlo nuevamente cuando termine la operación en curso." };
      }
      logger.warn("artefacto.eliminacion_sin_confirmar", { codigo: error.code });
    } else if (data === "DELETED") {
      return { success: true };
    } else if (data === "NOT_FOUND") {
      return { success: false, error: "El artefacto no está disponible en esta organización. Actualiza la lista." };
    } else if (data === "HAS_SOURCE_DOCUMENTS") {
      return { success: false, error: "El artefacto tiene fuentes documentales o cargas reservadas. La eliminación se bloqueó para conservarlas." };
    }
  } catch (error) {
    if (error instanceof AuthIdentityLookupError || error instanceof TenantContextLookupError) {
      return { success: false, error: "No se pudo verificar temporalmente tu acceso. Intenta de nuevo." };
    }
    logger.warn("artefacto.eliminacion_sin_confirmar");
  }

  return { success: false, error: `No se pudo confirmar la eliminación. Actualiza la lista antes de reintentar. Referencia: ${reference}.` };
}

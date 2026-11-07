"use server";

import { dispatchBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { markArtifactGenerationFailed } from "../artifacts/lib/artifact-generation-failure";
import { requireCourseSourceAccess } from "./course-source-access";
import { documentaryBaseSchema, reserveDocumentaryBase } from "./course-source-base.service";
import { CourseSourceError } from "./course-source-error";

export async function startDocumentaryBaseAction(payload: unknown) {
  const parsed = documentaryBaseSchema.safeParse(payload);
  if (!parsed.success) return { success: false, error: "Indica el propósito del curso en un máximo de 3,000 caracteres." };
  const input = parsed.data;
  const { artifactId, runId } = input;
  try {
    const { admin, tenant } = await requireCourseSourceAccess(artifactId);
    const formData = await reserveDocumentaryBase(admin, tenant.organizationId, input);
    if (!formData) return { success: true };
    const markFailed = (error: unknown) => markArtifactGenerationFailed(admin, artifactId, runId, error);
    try {
      await dispatchBackgroundFunctionJson("generate-artifact-background", {
        artifactId, runId, formData, documentary: true, organizationId: tenant.organizationId, userId: tenant.userId,
      }, {
        fallbackError: "No se pudo iniciar la generación de Base.",
        localHandlerLoader: () => import("../../../netlify/functions/generate-artifact-background"),
        onFailure: markFailed,
      });
    } catch (error) {
      // Una respuesta perdida no demuestra que Netlify rechazó el job.
      if (error instanceof TypeError || (error instanceof Error && error.name === "AbortError")) {
        return { success: true };
      }
      await markFailed(error);
      return { success: false, error: "No se pudo iniciar Base. Actualiza el curso y vuelve a intentar." };
    }
    return { success: true };
  } catch (error) {
    if (error instanceof CourseSourceError) return { success: false, error: error.message };
    console.warn("[Fuentes] No se pudo iniciar Base documental", { artifactId, runId });
    return { success: false, error: "No se pudo iniciar Base. Consulta el estado del curso antes de reintentar." };
  }
}

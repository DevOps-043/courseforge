"use server";

import { dispatchBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { requireCourseSourceAccess } from "./course-source-access";
import { documentaryBaseSchema, reserveDocumentaryBase } from "./course-source-base.service";
import { CourseSourceError } from "./course-source-error";
import { documentaryBaseScope } from "./course-source-base-continuation";

export async function startDocumentaryBaseAction(payload: unknown) {
  const parsed = documentaryBaseSchema.safeParse(payload);
  if (!parsed.success) return { success: false, error: "Indica el propósito del curso en un máximo de 3,000 caracteres." };
  const input = parsed.data;
  const { artifactId, runId } = input;
  try {
    const { admin, tenant } = await requireCourseSourceAccess(artifactId);
    const formData = await reserveDocumentaryBase(admin, tenant.organizationId, input, {
      scope: documentaryBaseScope(), userId: tenant.userId,
    });
    if (!formData) return { success: true };
    try {
      await dispatchBackgroundFunctionJson("generate-artifact-background", {
        artifactId, runId, continuation: true, documentary: true, organizationId: tenant.organizationId,
      }, {
        fallbackError: "No se pudo iniciar la generación de Base.",
        localHandlerLoader: () => import("../../../netlify/functions/generate-artifact-background"),
      });
    } catch {
      console.warn("[Fuentes] Base quedó reservada para reconciliar el despacho.", { artifactId, runId });
    }
    return { success: true };
  } catch (error) {
    if (error instanceof CourseSourceError) return { success: false, error: error.message };
    console.warn("[Fuentes] No se pudo iniciar Base documental", { artifactId, runId });
    return { success: false, error: "No se pudo iniciar Base. Consulta el estado del curso antes de reintentar." };
  }
}

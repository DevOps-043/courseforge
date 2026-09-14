import type { Handler } from "@netlify/functions";
import { z } from "zod";
import { getAuthorizedMaterialComponentAdminForTenant } from "../../src/lib/server/artifact-action-auth";
import {
  runSlideDeckGeneration,
  slideDeckGenerationRequestSchema,
} from "../../src/app/api/production/slides/generate/route";
import { failProductionJob } from "../../src/domains/production/jobs/production-jobs.service";
import { methodNotAllowedResponse, parseVerifiedBackgroundBody } from "./shared/http";

const slidesGenerationBackgroundRequestSchema = z.object({
  createdBy: z.string().uuid(),
  jobId: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  payload: slideDeckGenerationRequestSchema,
}).strict();

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();

  const untrustedRequest = await parseVerifiedBackgroundBody<unknown>(event);
  const request = slidesGenerationBackgroundRequestSchema.parse(untrustedRequest);
  let authorizedComponent: Awaited<ReturnType<typeof getAuthorizedMaterialComponentAdminForTenant>> = null;
  try {
    authorizedComponent = await getAuthorizedMaterialComponentAdminForTenant(
      request.payload.componentId,
      request.organizationId,
    );
    if (!authorizedComponent) {
      throw new Error("Componente de slides no encontrado para la organizacion firmada.");
    }

    await runSlideDeckGeneration({
      authorizedComponent,
      createdBy: request.createdBy,
      jobId: request.jobId,
      payload: request.payload,
    });
  } catch (error) {
    if (request.jobId && authorizedComponent) {
      await failProductionJob({
        error,
        jobId: request.jobId,
        supabase: authorizedComponent.admin,
      });
    }
    throw error;
  }
  return { statusCode: 200, body: "completed" };
};

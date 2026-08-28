import type { Handler } from "@netlify/functions";
import {
  verifyBackgroundPayload,
  type SignedBackgroundPayload,
} from "../../src/lib/server/background-payload-signature";
import { getAuthorizedMaterialComponentAdminForTenant } from "../../src/lib/server/artifact-action-auth";
import { runSlideDeckGeneration } from "../../src/app/api/production/slides/generate/route";
import { methodNotAllowedResponse, parseJsonBody } from "./shared/http";

interface SlidesGenerationBackgroundRequest {
  createdBy: string;
  jobId?: string;
  organizationId: string;
  payload: {
    componentId: string;
    [key: string]: unknown;
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();

  const envelope = parseJsonBody<SignedBackgroundPayload>(event);
  const request = verifyBackgroundPayload<SlidesGenerationBackgroundRequest>(envelope);
  const authorizedComponent = await getAuthorizedMaterialComponentAdminForTenant(
    request.payload.componentId,
    request.organizationId,
  );
  if (!authorizedComponent) {
    throw new Error("Componente de slides no encontrado para la organizacion firmada.");
  }

  const result = await runSlideDeckGeneration({
    authorizedComponent,
    createdBy: request.createdBy,
    jobId: request.jobId,
    payload: request.payload as Parameters<typeof runSlideDeckGeneration>[0]["payload"],
  });
  if (!result.ok) {
    throw new Error(await result.text());
  }
  return { statusCode: 200, body: "completed" };
};

import type { Handler } from "@netlify/functions";
import { z } from "zod";
import { createServiceRoleClient } from "./shared/bootstrap";
import { loadCurrentUserMemberships } from "../../src/lib/server/tenant-memberships";
import { assertSlideWorkerJob, assertSlideWorkerMembership, loadSlideWorkerComponent, failSlideWorkerBeforeGeneration } from "../../src/domains/production/slides/generation/slide-worker-access.server";
import { createOperationalLogger } from "../../src/lib/server/operational-logger";
import {
  runSlideDeckGeneration,
  slideDeckGenerationRequestSchema,
} from "../../src/app/api/production/slides/generate/route";
import { failProductionJob } from "../../src/domains/production/jobs/production-jobs.service";
import { methodNotAllowedResponse, parseVerifiedBackgroundBody } from "./shared/http";

const slidesGenerationBackgroundRequestSchema = z.object({
  createdBy: z.string().uuid(),
  jobId: z.string().uuid(),
  organizationId: z.string().uuid(),
  payload: slideDeckGenerationRequestSchema,
}).strict();

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();

  const untrustedRequest = await parseVerifiedBackgroundBody<unknown>(event);
  const request = slidesGenerationBackgroundRequestSchema.parse(untrustedRequest);
  const admin = createServiceRoleClient();
  const scope = { ...request, componentId: request.payload.componentId };
  const logger = createOperationalLogger("production.slides.worker", { jobId: request.jobId, componentId: scope.componentId });
  let authorizedComponent: Awaited<ReturnType<typeof loadSlideWorkerComponent>> | null = null;
  let jobVerified = false;
  try {
    logger.info("production.slides.worker_received");
    const job = await assertSlideWorkerJob(admin, scope);
    jobVerified = true;
    const memberships = await loadCurrentUserMemberships(request.createdBy);
    await assertSlideWorkerMembership(admin, scope, memberships);
    authorizedComponent = await loadSlideWorkerComponent(admin, scope, job.artifact_id);
    logger.info("production.slides.worker_authorized");

    await runSlideDeckGeneration({
      authorizedComponent,
      createdBy: request.createdBy,
      jobId: request.jobId,
      payload: request.payload,
    });
    logger.info("production.slides.worker_finished");
  } catch (error) {
    logger.error("production.slides.worker_failed", error);
    if (request.jobId && authorizedComponent) {
      await failProductionJob({
        error,
        jobId: request.jobId,
        supabase: authorizedComponent.admin,
      });
    } else if (jobVerified) {
      await failSlideWorkerBeforeGeneration(admin, scope);
    }
    throw error;
  }
  return { statusCode: 200, body: "completed" };
};

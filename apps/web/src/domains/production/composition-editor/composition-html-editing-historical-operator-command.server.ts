import { z } from "zod";
import { historicalHtmlHandoffLocatorSchema } from "./composition-html-editing-historical-handoff.server";
import { htmlHistoricalPublicationApprovalSchema, htmlHistoricalStagingLocatorSchema } from "./composition-html-editing-historical-publication.contract";
import type { createHistoricalHtmlOperatorWorkflow } from "./composition-html-editing-historical-operator.server";

const uuid = z.string().uuid();
const commandSchema = z.discriminatedUnion("action", [
  z.object({action: z.literal("PREPARE"), compositionId: uuid, draftId: uuid, revisionId: uuid, candidateId: uuid}).strict(),
  z.object({action: z.literal("STAGE"), locator: historicalHtmlHandoffLocatorSchema,
    approval: htmlHistoricalPublicationApprovalSchema.omit({reviewerId: true})}).strict(),
  z.object({action: z.literal("READ_STAGING"), locator: htmlHistoricalStagingLocatorSchema}).strict(),
]);
type Workflow = ReturnType<typeof createHistoricalHtmlOperatorWorkflow>;
type Runtime = Pick<Parameters<Workflow["prepareForReview"]>[0], "renderProfile" | "renderExecution" | "animationRuntimeSha256">;

/** CLI boundary: input never selects actor/tenant/runtime/credentials/approval
 * reviewer. Authentication is host-owned and refreshed for each invocation. */
export async function executeHistoricalHtmlOperatorCommand(input: unknown, ports: {
  authenticate: () => Promise<{actorId: string; organizationId: string}>;
  runtime: () => Promise<Runtime>; workflow: Workflow; signal: AbortSignal;
}) {
  const command = commandSchema.parse(input);
  ports.signal.throwIfAborted();
  const identity = z.object({actorId: uuid, organizationId: uuid}).strict().parse(await ports.authenticate());
  ports.signal.throwIfAborted();
  if (command.action === "PREPARE") {
    const runtime = await ports.runtime(); ports.signal.throwIfAborted();
    return {status: "PREPARED_FOR_INDEPENDENT_REVIEW" as const, locator: await ports.workflow.prepareForReview({
      ...runtime, candidateId: command.candidateId, signal: ports.signal,
      request: {...identity, compositionId: command.compositionId, draftId: command.draftId, revisionId: command.revisionId},
    })};
  }
  if (command.locator.organizationId !== identity.organizationId) throw new Error("HTML_HISTORICAL_OPERATOR_SCOPE_FORBIDDEN");
  if (command.action === "READ_STAGING") {
    if (command.locator.reviewerId !== identity.actorId) throw new Error("HTML_HISTORICAL_OPERATOR_SCOPE_FORBIDDEN");
    return ports.workflow.readStaging(command.locator, ports.signal);
  }
  return {status: "STAGED_NOT_PUBLISHED" as const, result: await ports.workflow.stageAfterReview({
    locator: command.locator, approval: {...command.approval, reviewerId: identity.actorId}, signal: ports.signal,
  })};
}

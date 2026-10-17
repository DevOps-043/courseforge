import { z } from "zod";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { htmlReconstructionApprovalSchema, htmlReconstructionTargetSchema, htmlReconstructionHandoffLocatorSchema,
  HTML_RECONSTRUCTION_POLICY } from "./composition-html-editing-reconstruction.contract";
import { htmlReconstructionOperatorIdentitySchema, type createHtmlReconstructionOperatorWorkflow } from "./composition-html-editing-reconstruction-operator.server";
import { buildHtmlReconstructionEditorPath } from "./composition-html-editing-reconstruction-opening.contract";

const uuid = z.string().uuid();
export const htmlReconstructionOperatorCommandSchema = z.discriminatedUnion("action", [
  z.object({action: z.literal("PREPARE"), compositionId: uuid, draftId: uuid, revisionId: uuid, candidateId: uuid,
    reconstruction: z.object({target: htmlReconstructionTargetSchema, document: compositionEditorDocumentSchema,
      expectedDocumentHash: z.string().regex(/^[a-f0-9]{64}$/)}).strict()}).strict(),
  z.object({action: z.literal("REVIEW"), locator: htmlReconstructionHandoffLocatorSchema,
    approval: htmlReconstructionApprovalSchema.omit({reviewerId: true})}).strict(),
  z.object({action: z.literal("READ_REVIEW"), candidateId: uuid}).strict(),
  z.object({action: z.literal("WITHDRAW_REVIEW"), candidateId: uuid, confirmation: z.literal("WITHDRAW_NEW_CONTENT_REVIEW")}).strict(),
  z.object({action: z.literal("STAGE"), candidateId: uuid, operationId: uuid}).strict(),
  z.object({action: z.literal("READ_STAGING"), operationId: uuid}).strict(),
  z.object({action: z.literal("CREATE"), operationId: uuid, confirmation: z.literal("CREATE_INDEPENDENT_CONTENT_WITHOUT_ACTIVATING_OR_CHANGING_ORIGINAL")}).strict(),
  z.object({action: z.literal("READ_CREATION"), operationId: uuid}).strict(),
]);
type Workflow = ReturnType<typeof createHtmlReconstructionOperatorWorkflow>;
type Runtime = Pick<Parameters<Workflow["prepareForReview"]>[0], "renderProfile" | "renderExecution" | "animationRuntimeSha256">;

/** Identity, runtime, catalog, service key and local roots are trusted host input,
 * never request fields. Recovery has no fallback to a writing action. */
export async function executeHtmlReconstructionOperatorCommand(input: unknown, ports: {
  authenticate: () => Promise<z.infer<typeof htmlReconstructionOperatorIdentitySchema>>;
  runtime: () => Promise<Runtime>; workflow: Workflow; signal: AbortSignal;
}) {
  ports.signal.throwIfAborted();
  if (Buffer.byteLength(JSON.stringify(input) ?? "") > HTML_RECONSTRUCTION_POLICY.registrationBytes)
    throw new Error("HTML_RECONSTRUCTION_OPERATOR_REQUEST_TOO_LARGE");
  const command = htmlReconstructionOperatorCommandSchema.parse(input), {workflow, signal} = ports;
  const identity = htmlReconstructionOperatorIdentitySchema.parse(await ports.authenticate()); signal.throwIfAborted();
  switch (command.action) {
    case "PREPARE": {
      const runtime = await ports.runtime(); signal.throwIfAborted();
      return {status: "PREPARED_FOR_INDEPENDENT_REVIEW" as const, locator: await workflow.prepareForReview({...runtime,
        candidateId: command.candidateId, reconstruction: command.reconstruction, signal,
        request: {...identity, compositionId: command.compositionId, draftId: command.draftId, revisionId: command.revisionId}}, identity)};
    }
    case "REVIEW": return workflow.recordReview({locator: command.locator,
      approval: {...command.approval, reviewerId: identity.actorId}, signal}, identity);
    case "READ_REVIEW": return workflow.readReview(command.candidateId, identity, signal);
    case "WITHDRAW_REVIEW": return workflow.withdrawReview(command.candidateId, identity, signal);
    case "STAGE": return workflow.stageAfterReview(command.candidateId, command.operationId, identity, signal);
    case "READ_STAGING": return workflow.readStaging(command.operationId, identity, signal);
    case "CREATE": {
      const receipt = await workflow.createAfterConfirmation(command.operationId, identity, signal);
      const locator = receipt.staging.review.locator;
      return {status: "CREATED_INDEPENDENT_CONTENT_NOT_PUBLISHED" as const, receipt,
        editorPath: buildHtmlReconstructionEditorPath({compositionId: locator.targetCompositionId, draftId: locator.targetDocumentId})};
    }
    case "READ_CREATION": {
      const result = await workflow.readCreation(command.operationId, identity, signal);
      if (result.status !== "RECORDED") return result;
      const locator = result.receipt.staging.review.locator;
      return {...result, editorPath: buildHtmlReconstructionEditorPath({compositionId: locator.targetCompositionId, draftId: locator.targetDocumentId})};
    }
  }
}

import type { HtmlEditingRevisionRepository } from "./html-editing/html-editing-revision-gateway.server";
import { HtmlEditingRevisionGateway } from "./html-editing/html-editing-revision-gateway.server";
import type { HtmlEditingExpectedRevision } from "./html-editing/html-editing-revision.contract";
import { htmlEditingMutationAcknowledgmentSchema, htmlEditingMutationRequestSchema, type HtmlEditingMutationInput } from "./composition-html-editing-mutation.contract";
import { htmlEditingOperationIdentitySchema, htmlEditingOperationReadSchema, HTML_EDITING_OPERATION_POLICY,
  type HtmlEditingOperationIdentity } from "./composition-html-editing-operation.contract";
import { computeHtmlEditingOperationRequestSha256 } from "./composition-html-editing-operation-digest.server";
import { HtmlEditingRevisionError } from "./html-editing/html-editing-revision.contract";

type RestoreInput = Parameters<HtmlEditingRevisionRepository["readAuthorized"]>[0] & { restore: HtmlEditingExpectedRevision };
type Repository = HtmlEditingRevisionRepository & { readRestoreRevision(input: RestoreInput): Promise<string> };
type DurableRepository = Repository & Required<Pick<HtmlEditingRevisionRepository, "commitOperation">> & {
  readOperation(input: Parameters<HtmlEditingRevisionRepository["readAuthorized"]>[0] & HtmlEditingOperationIdentity): Promise<unknown>;
};

/** Server coordinator. Source/declaration/history/grants are read independently;
 * browser controls only typed overrides, CAS references and a history locator. */
export function createHtmlEditingMutationService(repository: Repository) {
  return async (input: HtmlEditingMutationInput, signal?: AbortSignal) => (await mutate(repository, input, signal)).acknowledgment;
}

/** Opt-in host path. Operation ID is a correlation key, never authorization;
 * request digest is computed here, never accepted from the browser. Recorded
 * receipts are historical and can be returned without re-appending or rendering. */
export function createHtmlEditingDurableMutationService(repository: DurableRepository) {
  return async (input: HtmlEditingMutationInput, operationId: string, signal?: AbortSignal) => {
    const body = htmlEditingMutationRequestSchema.parse(input.action === "COMMAND"
      ? { action: input.action, expected: input.expected, expectedCompositionDocumentHash: input.expectedCompositionDocumentHash, overrides: input.overrides }
      : { action: input.action, expected: input.expected, expectedCompositionDocumentHash: input.expectedCompositionDocumentHash, restore: input.restore });
    const identity = htmlEditingOperationIdentitySchema.parse({ operationId, requestSha256: computeHtmlEditingOperationRequestSha256(body) });
    signal?.throwIfAborted();
    const response = await repository.readOperation({ actorId: input.actorId,
      scope: { organizationId: input.organizationId, documentId: input.documentId, clipId: input.clipId }, ...identity, signal });
    signal?.throwIfAborted();
    if (new TextEncoder().encode(JSON.stringify(response)).byteLength > HTML_EDITING_OPERATION_POLICY.maximumReceiptBytes) throw new HtmlEditingRevisionError("READ_UNAVAILABLE");
    const existing = htmlEditingOperationReadSchema.parse(response);
    if (existing.status === "RECORDED") {
      const receipt = existing.receipt;
      if (receipt.owner.actorId !== input.actorId || receipt.owner.organizationId !== input.organizationId
        || receipt.owner.draftId !== input.documentId || receipt.clipId !== input.clipId
        || receipt.operationId !== identity.operationId || receipt.requestSha256 !== identity.requestSha256
        || receipt.acknowledgment.previous.version !== body.expected.version || receipt.acknowledgment.previous.sha256 !== body.expected.sha256) {
        throw new HtmlEditingRevisionError("INVALID_REVISION");
      }
      return receipt;
    }
    // NOT_FOUND only permits this admitted first attempt; caller must never use
    // absence as proof that an already dispatched operation can be retried.
    const result = await mutate(repository, input, signal, identity);
    if (!result.operationReceipt) throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
    return result.operationReceipt;
  };
}

async function mutate(repository: Repository, input: HtmlEditingMutationInput, signal?: AbortSignal,
  operationIdentity?: HtmlEditingOperationIdentity) {
  const request = { actorId: input.actorId, scope: { organizationId: input.organizationId, documentId: input.documentId, clipId: input.clipId },
    expected: input.expected, expectedCompositionDocumentHash: input.expectedCompositionDocumentHash, signal, operationIdentity };
  const gateway = new HtmlEditingRevisionGateway(repository);
  signal?.throwIfAborted();
  const result = input.action === "RESTORE"
    ? await gateway.restore({ ...request, encodedRestoreRevision: await repository.readRestoreRevision({ ...request, restore: input.restore }) })
    : await gateway.apply({ ...request, encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1",
      binding: (await repository.readAuthorized(request)).authoritativeBinding, overrides: input.overrides }) });
  // The gateway ACK identifies this result at commit time, not current latest
  // state. A later GET must refresh native hash and inspector metadata.
  signal?.throwIfAborted();
  const acknowledgment = htmlEditingMutationAcknowledgmentSchema.parse({ scope: "EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED",
    changed: result.changed, previous: { version: result.before.version, sha256: result.beforeSha256 },
    next: { version: result.next.revision.version, sha256: result.next.sha256 } });
  return { acknowledgment, operationReceipt: result.operationReceipt };
}

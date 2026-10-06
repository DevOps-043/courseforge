import { z } from "zod";
import { htmlEditingBindingSchema, type HtmlEditingBinding } from "./html-editing.contract";
import { HtmlEditingRevisionError, type HtmlEditingExpectedRevision, type HtmlEditingRevision } from "./html-editing-revision.contract";
import {
  prepareHtmlEditingRevisionCommand, prepareHtmlEditingRevisionRestore,
  type HtmlEditingRevisionAuthority, type VerifiedHtmlEditingRevision,
} from "./html-editing-revision.server";
import { HTML_EDITING_OPERATION_POLICY, htmlEditingOperationIdentitySchema, htmlEditingOperationReceiptSchema,
  type HtmlEditingOperationIdentity, type HtmlEditingOperationReceipt } from "./html-editing-operation.contract";

const scopeSchema = htmlEditingBindingSchema.pick({ organizationId: true, documentId: true, clipId: true });
const actorSchema = z.string().uuid();
const acknowledgementSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("CONFLICT") }).strict(),
  z.object({ status: z.literal("COMMITTED"), version: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
type HtmlEditingRevisionScope = z.infer<typeof scopeSchema>;
type AuthorizedRevision = HtmlEditingRevisionAuthority & { encodedRevision: string; compositionDocumentHash: string };

/** Host-owned repository boundary. No caller-provided binding/grants/source.
 * A durable implementation must atomically recheck ownership, current grants,
 * source/manifest anchor and expected version+digest before appending. */
export interface HtmlEditingRevisionRepository {
  readAuthorized(input: { actorId: string; scope: HtmlEditingRevisionScope; signal?: AbortSignal }): Promise<AuthorizedRevision>;
  appendCompareAndSwap(input: {
    actorId: string; scope: HtmlEditingRevisionScope; expected: HtmlEditingExpectedRevision; expectedCompositionDocumentHash: string;
    authoritativeBinding: HtmlEditingBinding; revision: HtmlEditingRevision; sha256: string;
    operation: "COMMAND" | "RESTORE"; signal?: AbortSignal;
  }): Promise<{ status: "CONFLICT" } | { status: "COMMITTED"; version: number; sha256: string }>;
  commitOperation?: (input: Parameters<HtmlEditingRevisionRepository["appendCompareAndSwap"]>[0]
    & HtmlEditingOperationIdentity & { changed: boolean }) => Promise<HtmlEditingOperationReceipt>;
}

type GatewayRequest = {
  actorId: string; scope: HtmlEditingRevisionScope; expected: HtmlEditingExpectedRevision;
  expectedCompositionDocumentHash: string; signal?: AbortSignal;
  operationIdentity?: HtmlEditingOperationIdentity;
};
export type HtmlEditingRevisionMutationResult = {
  before: HtmlEditingRevision; beforeSha256: string; next: VerifiedHtmlEditingRevision; changed: boolean;
  operationReceipt?: HtmlEditingOperationReceipt;
};

/** Coordinator for the prepared repository and opt-in editorial HTTP service.
 * Success is returned only after exact CAS acknowledgement. Lost ACK is not
 * automatically retried; the host must reconcile against authorized storage. */
export class HtmlEditingRevisionGateway {
  constructor(private readonly repository: HtmlEditingRevisionRepository) {}

  apply(request: GatewayRequest & { encodedCommand: string }): Promise<HtmlEditingRevisionMutationResult> {
    return this.mutate(request, "COMMAND", authority => prepareHtmlEditingRevisionCommand({
      ...authority, expected: request.expected, encodedCommand: request.encodedCommand,
    }));
  }

  restore(request: GatewayRequest & { encodedRestoreRevision: string }): Promise<HtmlEditingRevisionMutationResult> {
    return this.mutate(request, "RESTORE", authority => prepareHtmlEditingRevisionRestore({
      ...authority, expected: request.expected, encodedRestoreRevision: request.encodedRestoreRevision,
    }));
  }

  private async mutate(request: GatewayRequest, operation: "COMMAND" | "RESTORE",
    prepare: (authority: AuthorizedRevision) => HtmlEditingRevisionMutationResult): Promise<HtmlEditingRevisionMutationResult> {
    const scope = scopeSchema.safeParse(request.scope);
    if (!scope.success || !actorSchema.safeParse(request.actorId).success
      || !/^[a-f0-9]{64}$/.test(request.expectedCompositionDocumentHash)) throw new HtmlEditingRevisionError("INVALID_REVISION");
    const identity = request.operationIdentity ? htmlEditingOperationIdentitySchema.safeParse(request.operationIdentity) : null;
    if (identity && (!identity.success || !this.repository.commitOperation)) throw new HtmlEditingRevisionError("INVALID_REVISION");
    request.signal?.throwIfAborted();
    let authority: AuthorizedRevision;
    try { authority = await this.repository.readAuthorized({ actorId: request.actorId, scope: scope.data, signal: request.signal }); }
    catch { request.signal?.throwIfAborted(); throw new HtmlEditingRevisionError("READ_UNAVAILABLE"); }
    if (authority.compositionDocumentHash !== request.expectedCompositionDocumentHash) throw new HtmlEditingRevisionError("REVISION_CONFLICT");
    // Repository output still cannot substitute a foreign template or document.
    const binding = htmlEditingBindingSchema.safeParse(authority.authoritativeBinding);
    if (!binding.success || binding.data.organizationId !== scope.data.organizationId
      || binding.data.documentId !== scope.data.documentId || binding.data.clipId !== scope.data.clipId) {
      throw new HtmlEditingRevisionError("INVALID_REVISION");
    }
    request.signal?.throwIfAborted();
    const prepared = prepare(authority);
    if (identity?.success) {
      request.signal?.throwIfAborted();
      try {
        const response = await this.repository.commitOperation!({ actorId: request.actorId, scope: scope.data,
          expected: { version: prepared.before.version, sha256: prepared.beforeSha256 },
          expectedCompositionDocumentHash: request.expectedCompositionDocumentHash, authoritativeBinding: { ...binding.data },
          revision: structuredClone(prepared.next.revision), sha256: prepared.next.sha256, operation,
          ...identity.data, changed: prepared.changed, signal: request.signal });
        if (new TextEncoder().encode(JSON.stringify(response)).byteLength > HTML_EDITING_OPERATION_POLICY.maximumReceiptBytes) throw new Error();
        const receipt = htmlEditingOperationReceiptSchema.parse(response), ack = receipt.acknowledgment;
        if (receipt.owner.actorId !== request.actorId || receipt.owner.organizationId !== scope.data.organizationId
          || receipt.owner.draftId !== scope.data.documentId || receipt.clipId !== scope.data.clipId
          || receipt.operationId !== identity.data.operationId || receipt.requestSha256 !== identity.data.requestSha256
          || ack.changed !== prepared.changed || ack.previous.version !== prepared.before.version || ack.previous.sha256 !== prepared.beforeSha256
          || ack.next.version !== prepared.next.revision.version || ack.next.sha256 !== prepared.next.sha256) throw new Error();
        request.signal?.throwIfAborted();
        return { ...prepared, operationReceipt: receipt };
      } catch {
        // No legacy fallback, including no-op, cancellation or lost receipt.
        throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
      }
    }
    if (!prepared.changed) return prepared;
    request.signal?.throwIfAborted();
    let acknowledgement: Awaited<ReturnType<HtmlEditingRevisionRepository["appendCompareAndSwap"]>>;
    try {
      acknowledgement = await this.repository.appendCompareAndSwap({
        actorId: request.actorId, scope: scope.data,
        expected: { version: prepared.before.version, sha256: prepared.beforeSha256 },
        expectedCompositionDocumentHash: request.expectedCompositionDocumentHash,
        authoritativeBinding: { ...binding.data }, revision: structuredClone(prepared.next.revision),
        sha256: prepared.next.sha256, operation, signal: request.signal,
      });
    } catch {
      // Cancellation during a write is also uncertain: it may have committed.
      throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
    }
    const parsedAcknowledgement = acknowledgementSchema.safeParse(acknowledgement);
    if (!parsedAcknowledgement.success) throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
    if (parsedAcknowledgement.data.status === "CONFLICT") throw new HtmlEditingRevisionError("REVISION_CONFLICT");
    if (parsedAcknowledgement.data.version !== prepared.next.revision.version || parsedAcknowledgement.data.sha256 !== prepared.next.sha256) {
      throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
    }
    return prepared;
  }
}

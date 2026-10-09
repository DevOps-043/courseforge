import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document.service";
import { prepareHtmlEditingLegacyAdoption } from "./composition-html-editing-legacy-adoption.server";
import type { HtmlEditingTemplateCatalog } from "./html-editing/html-editing-template-catalog.server";
import { HTML_LEGACY_ADOPTION_POLICY as policy, htmlLegacyAdoptionCandidateSchema,
  htmlLegacyAdoptionCommandSchema, htmlLegacyAdoptionReadSchema, htmlLegacyAdoptionReceiptSchema,
  type HtmlLegacyAdoptionCandidate, type HtmlLegacyAdoptionCommand, type HtmlLegacyAdoptionReceipt,
} from "./composition-html-editing-legacy-adoption.contract";
import { computeHtmlLegacyAdoptionRequestSha256 } from "./composition-html-editing-legacy-adoption-digest.server";

export class HtmlLegacyAdoptionPersistenceError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "CONFLICT" | "READ_UNAVAILABLE" | "COMMIT_UNCONFIRMED") {
    super(`HTML_LEGACY_ADOPTION_${code}`); this.name = "HtmlLegacyAdoptionPersistenceError";
  }
}
const contextSchema = z.object({ organizationId: z.string().uuid(), documentId: z.string().uuid(), clipId: z.string(),
  revisionId: z.string().uuid(), documentHash: z.string().regex(/^[a-f0-9]{64}$/), document: z.unknown(),
  grantedAssetIds: z.array(z.string().uuid()).max(6400).refine(ids => new Set(ids).size === ids.length),
}).strict();

/** Only a trusted host may stage a human-reviewed candidate. Browser adoption
 * submits IDs/CAS only; this adapter rereads approval, native base, catalogue and
 * grants. SQL owns atomic commit and revocation, never a compensating append. */
export class SupabaseHtmlLegacyAdoptionRepository {
  constructor(private readonly supabase: SupabaseClient, private readonly catalog?: HtmlEditingTemplateCatalog) {}

  async stageReviewedCandidate(input: HtmlLegacyAdoptionCandidate, signal?: AbortSignal) {
    const candidate = this.parseCandidate(input);
    const effectiveSignal = this.signal(signal);
    const prepared = await this.prepare(candidate, candidate.approval.reviewerId, effectiveSignal);
    const response = await this.rpc("record_html_editing_legacy_candidate", {
      p_organization_id: candidate.organizationId, p_draft_id: candidate.documentId,
      p_clip_id: candidate.clipId, p_actor_id: candidate.approval.reviewerId, p_candidate: candidate,
    }, effectiveSignal, true, policy.receiptBytes);
    if (response !== true && response !== false) throw new HtmlLegacyAdoptionPersistenceError("COMMIT_UNCONFIRMED");
    return { recorded: true as const, created: response, candidateId: candidate.candidateId,
      provenanceSha256: prepared.provenanceSha256 };
  }

  /** Explicit command only. Caller must persist its journal before dispatch.
   * An ambiguous result is recovered with readOperation, never retried here. */
  async commit(input: HtmlLegacyAdoptionCommand, signal?: AbortSignal) {
    const command = this.parseCommand(input), effectiveSignal = this.signal(signal);
    const recorded = await this.readOperation(command, effectiveSignal);
    if (recorded.status === "RECORDED") return recorded.receipt;
    const raw = await this.rpc("read_html_editing_legacy_candidate", { ...this.scope(command),
      p_candidate_id: command.request.candidateId }, effectiveSignal, false, policy.candidateBytes);
    const candidate = this.parseCandidate(raw);
    if (candidate.organizationId !== command.organizationId || candidate.documentId !== command.documentId
      || candidate.clipId !== command.clipId || candidate.candidateId !== command.request.candidateId
      || candidate.provenanceSha256 !== command.request.provenanceSha256
      || candidate.expectedDocumentHash !== command.request.expectedDocumentHash)
      throw new HtmlLegacyAdoptionPersistenceError("CONFLICT");
    const prepared = await this.prepare(candidate, command.actorId, effectiveSignal);
    const requestSha256 = computeHtmlLegacyAdoptionRequestSha256(command);
    const result = await this.rpc("commit_html_editing_legacy_adoption", { ...this.scope(command),
      p_operation_id: command.operationId, p_request_sha256: requestSha256, p_request: command.request,
      p_revision: prepared.initialRevision, p_revision_sha256: prepared.initialRevisionSha256,
      p_document: prepared.document, p_document_hash: prepared.documentHash, p_used_asset_ids: prepared.usedAssetIds,
    }, effectiveSignal, true, policy.receiptBytes);
    const receipt = this.validateReceipt(result, command, "COMMIT_UNCONFIRMED");
    if (receipt.acknowledgment.compositionDocumentHash !== prepared.documentHash
      || receipt.acknowledgment.revisionSha256 !== prepared.initialRevisionSha256)
      throw new HtmlLegacyAdoptionPersistenceError("COMMIT_UNCONFIRMED");
    return receipt;
  }

  /** Historical result only. NOT_FOUND is not permission to repeat a lost POST. */
  async readOperation(input: HtmlLegacyAdoptionCommand, signal?: AbortSignal) {
    const command = this.parseCommand(input);
    const raw = await this.rpc("read_html_editing_legacy_adoption_operation", { ...this.scope(command),
      p_operation_id: command.operationId }, this.signal(signal), false, policy.receiptBytes);
    const result = htmlLegacyAdoptionReadSchema.safeParse(raw);
    if (!result.success) throw new HtmlLegacyAdoptionPersistenceError("READ_UNAVAILABLE");
    if (result.data.status === "RECORDED") this.validateReceipt(result.data.receipt, command, "READ_UNAVAILABLE");
    return result.data;
  }

  private async prepare(candidate: HtmlLegacyAdoptionCandidate, actorId: string, signal: AbortSignal) {
    if (!this.catalog) throw new HtmlLegacyAdoptionPersistenceError("READ_UNAVAILABLE");
    const raw = await this.rpc("read_html_editing_bootstrap_context", {
      p_organization_id: candidate.organizationId, p_draft_id: candidate.documentId, p_clip_id: candidate.clipId,
      p_actor_id: actorId, p_expected_document_hash: candidate.expectedDocumentHash,
    }, signal, false, policy.responseBytes);
    const parsed = contextSchema.safeParse(raw);
    if (!parsed.success) throw new HtmlLegacyAdoptionPersistenceError("READ_UNAVAILABLE");
    const context = parsed.data;
    if (context.organizationId !== candidate.organizationId || context.documentId !== candidate.documentId
      || context.clipId !== candidate.clipId || context.revisionId !== candidate.revisionId
      || context.documentHash !== candidate.expectedDocumentHash) throw new HtmlLegacyAdoptionPersistenceError("CONFLICT");
    const document = compositionEditorDocumentSchema.safeParse(context.document);
    if (!document.success || hashCompositionDocument(document.data) !== candidate.expectedDocumentHash)
      throw new HtmlLegacyAdoptionPersistenceError("READ_UNAVAILABLE");
    const result = prepareHtmlEditingLegacyAdoption({ document: document.data, expectedDocumentHash: context.documentHash,
      anchor: { organizationId: candidate.organizationId, documentId: candidate.documentId,
        clipId: candidate.clipId, revisionId: context.revisionId },
      templateId: candidate.templateId, templateVersion: candidate.templateVersion, catalog: this.catalog,
      encodedPilot: candidate.encodedPilot, expectedProvenanceSha256: candidate.provenanceSha256,
      grantedAssetIds: context.grantedAssetIds,
      imageSources: new Map(context.grantedAssetIds.map(id => [id, `conformance-media/${id}`])),
    });
    if (result.originalSourceSha256 !== candidate.originalSourceSha256
      || createHash("sha256").update(result.initialRevision.sourceHtml, "utf8").digest("hex") !== candidate.candidateSourceSha256)
      throw new HtmlLegacyAdoptionPersistenceError("CONFLICT");
    signal.throwIfAborted();
    return result;
  }

  private validateReceipt(input: unknown, command: HtmlLegacyAdoptionCommand, code: "READ_UNAVAILABLE" | "COMMIT_UNCONFIRMED"): HtmlLegacyAdoptionReceipt {
    const parsed = htmlLegacyAdoptionReceiptSchema.safeParse(input);
    if (!parsed.success) throw new HtmlLegacyAdoptionPersistenceError(code);
    const receipt = parsed.data;
    if (receipt.owner.actorId !== command.actorId || receipt.owner.organizationId !== command.organizationId
      || receipt.owner.draftId !== command.documentId || receipt.clipId !== command.clipId
      || receipt.operationId !== command.operationId || receipt.requestSha256 !== computeHtmlLegacyAdoptionRequestSha256(command)
      || receipt.request.candidateId !== command.request.candidateId || receipt.request.provenanceSha256 !== command.request.provenanceSha256
      || receipt.request.expectedDocumentHash !== command.request.expectedDocumentHash)
      throw new HtmlLegacyAdoptionPersistenceError(code);
    return receipt;
  }
  private parseCommand(input: unknown) {
    const parsed = htmlLegacyAdoptionCommandSchema.safeParse(input);
    if (!parsed.success) throw new HtmlLegacyAdoptionPersistenceError("INVALID_INPUT");
    return parsed.data;
  }
  private parseCandidate(input: unknown) {
    if (Buffer.byteLength(JSON.stringify(input) ?? "", "utf8") > policy.candidateBytes)
      throw new HtmlLegacyAdoptionPersistenceError("INVALID_INPUT");
    const parsed = htmlLegacyAdoptionCandidateSchema.safeParse(input);
    if (!parsed.success || Buffer.byteLength(parsed.data.encodedPilot, "utf8") > policy.pilotBytes)
      throw new HtmlLegacyAdoptionPersistenceError("INVALID_INPUT");
    return parsed.data;
  }
  private scope(command: HtmlLegacyAdoptionCommand) {
    return { p_organization_id: command.organizationId, p_draft_id: command.documentId,
      p_clip_id: command.clipId, p_actor_id: command.actorId };
  }
  private signal(signal?: AbortSignal) {
    return signal ? AbortSignal.any([signal, AbortSignal.timeout(policy.rpcTimeoutMs)]) : AbortSignal.timeout(policy.rpcTimeoutMs);
  }
  private async rpc(name: string, parameters: Record<string, unknown>, signal: AbortSignal, mutation: boolean, maximumBytes: number): Promise<unknown> {
    try {
      signal.throwIfAborted();
      const response = await this.supabase.rpc(name, parameters).abortSignal(signal);
      signal.throwIfAborted();
      if (response.error) {
        if (["HTML_LEGACY_ADOPTION_CONFLICT", "HTML_LEGACY_ADOPTION_ID_REUSED", "HTML_EDITING_REVISION_CONFLICT"].includes(response.error.message))
          throw new HtmlLegacyAdoptionPersistenceError("CONFLICT");
        throw new Error();
      }
      if (Buffer.byteLength(JSON.stringify(response.data) ?? "", "utf8") > maximumBytes) throw new Error();
      return response.data;
    } catch (error) {
      if (error instanceof HtmlLegacyAdoptionPersistenceError) throw error;
      throw new HtmlLegacyAdoptionPersistenceError(mutation ? "COMMIT_UNCONFIRMED" : "READ_UNAVAILABLE");
    }
  }
}

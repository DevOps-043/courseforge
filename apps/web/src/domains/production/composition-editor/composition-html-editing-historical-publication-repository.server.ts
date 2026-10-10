import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { canonicalHtmlEditingJson } from "./html-editing/html-editing-canonical-json.server";
import { createHtmlEditingSnapshotArchiveStore } from "./composition-html-editing-snapshot-storage.server";
import { verifyPreparedHtmlSnapshotPayload } from "./composition-html-editing-snapshot-repository.server";
import { readHtmlSnapshotZipMember } from "./composition-html-editing-snapshot-zip.server";
import { HTML_HISTORICAL_PUBLICATION_POLICY as policy, htmlHistoricalPublicationApprovalSchema,
  htmlHistoricalPublicationArchiveSchema, htmlHistoricalPublicationCommandSchema, htmlHistoricalPublicationProvenanceSchema,
  htmlHistoricalPublicationReadSchema, htmlHistoricalPublicationReceiptSchema,
  htmlHistoricalStagingLocatorSchema, htmlHistoricalStagingReadSchema, type HtmlHistoricalStagingLocator,
  htmlHistoricalStagingJournalAckSchema, type HtmlHistoricalStagingJournalAck,
  type HtmlHistoricalPublicationCommand } from "./composition-html-editing-historical-publication.contract";
import { historicalHtmlPublicationRequestPreimage } from "./composition-html-editing-historical-publication-preimage";
import type { createHistoricalHtmlCandidatePreparer } from "./composition-html-editing-historical-candidate.server";
import { htmlHistoricalCandidateReadRequestSchema, htmlHistoricalCandidateViewSchema,
  matchesHistoricalHtmlCandidate, type HtmlHistoricalCandidateReadRequest } from "./composition-html-editing-historical-candidate.contract";

type Artifact = Awaited<ReturnType<ReturnType<typeof createHistoricalHtmlCandidatePreparer>>>;
type Prepared = Omit<Artifact["prepared"], "archiveBytes">;
const preparedEnvelope = z.object({ projectHash: z.string().regex(/^[a-f0-9]{64}$/),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/), contract: z.object({}).passthrough(),
  assets: z.array(z.unknown()), metadata: z.object({}).passthrough(), fontManifest: z.array(z.unknown()),
  bundle: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough(),
  scope: z.literal("PREPARED_ARCHIVE_NOT_UPLOADED_OR_RENDERED"),
}).strict();
const candidateEnvelope = z.object({ provenance: htmlHistoricalPublicationProvenanceSchema,
  approval: htmlHistoricalPublicationApprovalSchema, archive: htmlHistoricalPublicationArchiveSchema,
  prepared: preparedEnvelope, candidateSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
/** Transport-normalized, bounded candidate encoding. Unlike HTML source
 * canonicalization, contract metadata can contain null and optional fields. */
function canonicalCandidateJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (!serialized || Buffer.byteLength(serialized, "utf8") > policy.candidateBytes) throw new Error("HTML_HISTORICAL_CANDIDATE_INVALID");
  const encode = (entry: JsonValue): string => entry === null || typeof entry !== "object" ? JSON.stringify(entry)
    : Array.isArray(entry) ? `[${entry.map(encode).join(",")}]`
      : `{${Object.keys(entry).sort().map(key => `${JSON.stringify(key)}:${encode(entry[key]!)}`).join(",")}}`;
  return encode(JSON.parse(serialized) as JsonValue);
}

/** Operator staging is NOT an HTTP approval API. Only pass artifacts from the
 * trusted assembler, after independent review of the exact full ZIP hash.
 * Normal publication's active ACK/intent tables are deliberately untouched. */
export class HistoricalHtmlPublicationRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async stageReviewedCandidate(input: { artifact: Artifact;
    approval: z.infer<typeof htmlHistoricalPublicationApprovalSchema>;
    storeArchive: ReturnType<typeof createHtmlEditingSnapshotArchiveStore>;
    recordStagingLocator?: (locator: HtmlHistoricalStagingLocator, signal: AbortSignal) => Promise<HtmlHistoricalStagingJournalAck>;
    signal?: AbortSignal }) {
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(policy.stagingTimeoutMs)])
      : AbortSignal.timeout(policy.stagingTimeoutMs);
    signal.throwIfAborted();
    const provenance = htmlHistoricalPublicationProvenanceSchema.parse(input.artifact.provenance);
    const approval = htmlHistoricalPublicationApprovalSchema.parse(input.approval);
    // Capture caller-owned data before the first await. Approval must continue to
    // identify exactly these bytes even if the operator releases its artifact.
    const archiveBytes = Buffer.from(input.artifact.prepared.archiveBytes);
    const { archiveBytes: omittedArchive, ...preparedInput } = input.artifact.prepared;
    void omittedArchive;
    preparedEnvelope.parse(preparedInput);
    const preparedJson = canonicalCandidateJson(preparedInput);
    if (Buffer.byteLength(preparedJson, "utf8") > policy.candidateBytes) throw new Error("HTML_HISTORICAL_CANDIDATE_INVALID");
    const prepared = JSON.parse(preparedJson) as Prepared;
    if (input.artifact.scope !== "PREPARED_HISTORICAL_ARCHIVE_NOT_APPROVED_UPLOADED_OR_PUBLISHED"
      || digest(archiveBytes) !== prepared.projectHash || approval.reviewedProjectHash !== prepared.projectHash
      || prepared.projectHash === provenance.originalProjectHash || prepared.bundle.sha256 !== provenance.candidateBundleSha256) throw new Error("HTML_HISTORICAL_CANDIDATE_INVALID");
    const marker = await readHtmlSnapshotZipMember({ archiveBytes, path: policy.provenancePath, maximumBytes: policy.receiptBytes, signal });
    if (marker.toString("utf8") !== canonicalHtmlEditingJson(provenance)) throw new Error("HTML_HISTORICAL_CANDIDATE_INVALID");
    const archive = htmlHistoricalPublicationArchiveSchema.parse({ projectHash: prepared.projectHash,
      sizeBytes: archiveBytes.length, storageBucket: "production-assets",
      storagePath: `composition-snapshots/${provenance.organizationId}/${provenance.compositionId}/${prepared.projectHash}.zip` });
    await this.verifyCandidate({ provenance, approval, archive, prepared }, approval.reviewerId, signal);
    const content = { provenance, approval, archive, prepared }, candidateSha256 = digest(canonicalCandidateJson(content));
    const candidate = { ...content, candidateSha256 };
    const locator = htmlHistoricalStagingLocatorSchema.parse({scope: "HISTORICAL_STAGING_LOCATOR_NOT_APPROVAL_OR_PUBLICATION",
      organizationId: provenance.organizationId, compositionId: provenance.compositionId, draftId: provenance.draftId,
      reviewerId: approval.reviewerId, candidateId: provenance.candidateId, candidateSha256,
      projectHash: archive.projectHash, evidenceSha256: approval.evidenceSha256});
    // The operator must durably preserve and read back this locator BEFORE a
    // write can become uncertain. This port does not authorize approval or retry.
    const recordedLocator = htmlHistoricalStagingJournalAckSchema.parse(await (input.recordStagingLocator
      ? input.recordStagingLocator(structuredClone(locator), signal) : this.recordStagingLocator(locator, signal)));
    signal.throwIfAborted();
    if (!isDeepStrictEqual(recordedLocator.locator, locator)) throw new Error("HTML_HISTORICAL_LOCATOR_ACK_INVALID");
    if (!recordedLocator.created) throw new Error("HTML_HISTORICAL_STAGING_ALREADY_ATTEMPTED_USE_RECOVERY");
    // Staging already-approved bytes can leave an orphan on uncertain ACK. Never
    // compensate/delete, rebuild after approval or retry this upload here.
    const uploadBytes = new Uint8Array(archiveBytes);
    const stored = htmlHistoricalPublicationArchiveSchema.parse(await input.storeArchive({
      organizationId: provenance.organizationId, compositionId: provenance.compositionId, projectHash: archive.projectHash,
      bytes: uploadBytes, contentType: "application/zip", signal,
    }));
    signal.throwIfAborted();
    if (digest(uploadBytes) !== archive.projectHash || !isDeepStrictEqual(stored, archive)) throw new Error("HTML_HISTORICAL_STORAGE_ACK_INVALID");
    await this.verifyCandidate(candidate, approval.reviewerId, signal);
    const result = await this.rpc("record_html_historical_candidate", { p_org: provenance.organizationId,
      p_actor: approval.reviewerId, p_composition: provenance.compositionId, p_draft: provenance.draftId,
      p_candidate: provenance.candidateId, p_payload: candidate }, signal, policy.receiptBytes);
    if (result !== true && result !== false) throw new Error("HTML_HISTORICAL_STAGE_UNCONFIRMED");
    return { candidateId: provenance.candidateId, candidateSha256, created: result, locator };
  }

  /** Private operator journal adapter. Immutable identity, no upload/approval;
   * an uncertain ACK must be investigated by readStaging, never stage again. */
  async recordStagingLocator(input: HtmlHistoricalStagingLocator, parent?: AbortSignal) {
    const locator = htmlHistoricalStagingLocatorSchema.parse(input), signal = this.signal(parent);
    const recorded = htmlHistoricalStagingJournalAckSchema.parse(await this.rpc("record_html_historical_staging_locator", {
      ...this.scope({...locator, actorId: locator.reviewerId}), p_locator: locator,
    }, signal, policy.receiptBytes));
    if (!isDeepStrictEqual(recorded.locator, locator)) throw new Error("HTML_HISTORICAL_LOCATOR_ACK_INVALID");
    return recorded;
  }

  /** Metadata-only reconciliation after uncertain staging. NOT_FOUND does not
   * distinguish absent upload from an orphan and never permits another write. */
  async readStaging(input: HtmlHistoricalStagingLocator, parent?: AbortSignal) {
    const locator = htmlHistoricalStagingLocatorSchema.parse(input), signal = this.signal(parent);
    const result = htmlHistoricalStagingReadSchema.parse(await this.rpc("read_html_historical_staging", {
      ...this.scope({...locator, actorId: locator.reviewerId}), p_candidate: locator.candidateId,
      p_candidate_sha256: locator.candidateSha256, p_project_hash: locator.projectHash,
      p_evidence_sha256: locator.evidenceSha256,
    }, signal, policy.receiptBytes));
    if (result.status !== "NOT_FOUND" && !isDeepStrictEqual(result.locator, locator)) throw new Error("HTML_HISTORICAL_LOCATOR_ACK_INVALID");
    return result;
  }

  async commit(input: HtmlHistoricalPublicationCommand, parent?: AbortSignal) {
    const command = htmlHistoricalPublicationCommandSchema.parse(input), signal = this.signal(parent);
    const previous = await this.readOperation(command, signal);
    if (previous.status === "RECORDED") return previous.receipt;
    const candidate = candidateEnvelope.parse(await this.rpc("read_html_historical_candidate", {
      ...this.scope(command), p_candidate: command.request.candidateId }, signal, policy.candidateBytes));
    if (candidate.candidateSha256 !== command.request.candidateSha256 || candidate.provenance.candidateId !== command.request.candidateId
      || candidate.provenance.organizationId !== command.organizationId || candidate.provenance.compositionId !== command.compositionId
      || candidate.provenance.draftId !== command.draftId) throw new Error("HTML_HISTORICAL_CANDIDATE_CONFLICT");
    const payload = await this.verifyCandidate(candidate, command.actorId, signal);
    const requestSha256 = digest(historicalHtmlPublicationRequestPreimage(command));
    const raw = await this.rpc("commit_html_historical_publication", { ...this.scope(command),
      p_operation: command.operationId, p_request_sha256: requestSha256, p_request: command.request,
      p_registration: payload }, signal, policy.receiptBytes);
    const receipt = this.receipt(raw, command);
    if (receipt.projectHash !== candidate.archive.projectHash || receipt.originalRevisionId !== candidate.provenance.originalRevisionId
      || receipt.originalProjectHash !== candidate.provenance.originalProjectHash) throw new Error("HTML_HISTORICAL_ACK_INVALID");
    return receipt;
  }

  /** Current authorized projection of a previously operator-approved candidate.
   * Never returns the private bundle, HTML, Storage path, assets or signed URLs.
   * This GET is not an approval/commit and cannot replace commit reauthorization. */
  async readCandidate(input: HtmlHistoricalCandidateReadRequest, parent?: AbortSignal) {
    const request = htmlHistoricalCandidateReadRequestSchema.parse(input), signal = this.signal(parent);
    const read = async () => candidateEnvelope.parse(await this.rpc("read_html_historical_candidate", {
      ...this.scope(request), p_candidate: request.request.candidateId,
    }, signal, policy.candidateBytes));
    const candidate = await read();
    const view = htmlHistoricalCandidateViewSchema.parse({...request,
      scope: "AUTHORIZED_HISTORICAL_CANDIDATE_NOT_PUBLISHED_OR_RENDERED",
      provenance: candidate.provenance, approval: candidate.approval, projectHash: candidate.archive.projectHash});
    if (!matchesHistoricalHtmlCandidate(view, request) || candidate.candidateSha256 !== request.request.candidateSha256)
      throw new Error("HTML_HISTORICAL_CANDIDATE_CONFLICT");
    await this.verifyCandidate(candidate, request.actorId, signal);
    // The final RPC reauthorizes revocation/reviewer/original/resource bindings
    // after compilation. A changed candidate cannot be shown as the reviewed one.
    const refreshed = await read();
    if (!isDeepStrictEqual(candidate, refreshed)) throw new Error("HTML_HISTORICAL_CANDIDATE_CONFLICT");
    signal.throwIfAborted();
    if (Buffer.byteLength(JSON.stringify(view), "utf8") > policy.receiptBytes) throw new Error("HTML_HISTORICAL_CANDIDATE_INVALID");
    return view;
  }

  /** Metadata receipt only: no compiler, Storage, upload, retry or reactivation. */
  async readOperation(input: HtmlHistoricalPublicationCommand, parent?: AbortSignal) {
    const command = htmlHistoricalPublicationCommandSchema.parse(input), signal = this.signal(parent);
    const raw = await this.rpc("read_html_historical_publication_operation", { ...this.scope(command),
      p_operation: command.operationId, p_request_sha256: digest(historicalHtmlPublicationRequestPreimage(command)) }, signal, policy.receiptBytes);
    const result = htmlHistoricalPublicationReadSchema.parse(raw);
    if (result.status === "RECORDED") this.receipt(result.receipt, command);
    return result;
  }

  private async verifyCandidate(input: { provenance: z.infer<typeof htmlHistoricalPublicationProvenanceSchema>;
    approval: z.infer<typeof htmlHistoricalPublicationApprovalSchema>; archive: z.infer<typeof htmlHistoricalPublicationArchiveSchema>;
    prepared: unknown; candidateSha256?: string }, actorId: string, signal: AbortSignal) {
    if (input.candidateSha256 && input.candidateSha256 !== digest(canonicalCandidateJson({
      provenance: input.provenance, approval: input.approval, archive: input.archive, prepared: input.prepared }))) throw new Error("HTML_HISTORICAL_CANDIDATE_INVALID");
    if (input.approval.reviewedProjectHash !== input.archive.projectHash || input.archive.projectHash === input.provenance.originalProjectHash) throw new Error("HTML_HISTORICAL_CANDIDATE_INVALID");
    preparedEnvelope.parse(input.prepared);
    const provenance = input.provenance, prepared = input.prepared as Prepared;
    const registration = await verifyPreparedHtmlSnapshotPayload(this.supabase, { actorId,
      organizationId: provenance.organizationId, compositionId: provenance.compositionId, draftId: provenance.documentId,
      documentHash: provenance.documentHash, archive: input.archive, prepared, signal });
    if (prepared.bundle.sha256 !== provenance.candidateBundleSha256) throw new Error("HTML_HISTORICAL_CANDIDATE_INVALID");
    const result = { ...registration, manifest: { ...registration.manifest, historical_html_republication: provenance } };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > policy.candidateBytes) throw new Error("HTML_HISTORICAL_CANDIDATE_INVALID");
    return result;
  }

  private receipt(raw: unknown, command: HtmlHistoricalPublicationCommand) {
    const receipt = htmlHistoricalPublicationReceiptSchema.parse(raw);
    if (receipt.requestSha256 !== digest(historicalHtmlPublicationRequestPreimage(command))
      || Object.entries(command).some(([key, value]) => !isDeepStrictEqual(value, receipt[key as keyof typeof command]))) throw new Error("HTML_HISTORICAL_ACK_INVALID");
    return receipt;
  }
  private scope(command: Pick<HtmlHistoricalPublicationCommand, "organizationId" | "actorId" | "compositionId" | "draftId">) {
    return { p_org: command.organizationId, p_actor: command.actorId, p_composition: command.compositionId, p_draft: command.draftId };
  }
  private signal(parent?: AbortSignal) { return parent ? AbortSignal.any([parent, AbortSignal.timeout(policy.rpcTimeoutMs)]) : AbortSignal.timeout(policy.rpcTimeoutMs); }
  private async rpc(name: string, parameters: Record<string, unknown>, signal: AbortSignal, maximumBytes: number) {
    signal.throwIfAborted();
    const boundedSignal = this.signal(signal);
    try {
      const result = await this.supabase.rpc(name, parameters).abortSignal(boundedSignal); boundedSignal.throwIfAborted();
      if (result.error || result.data == null || Buffer.byteLength(JSON.stringify(result.data), "utf8") > maximumBytes) throw new Error("HTML_HISTORICAL_OPERATION_UNCONFIRMED");
      return result.data;
    } catch {
      signal.throwIfAborted();
      throw new Error("HTML_HISTORICAL_OPERATION_UNCONFIRMED");
    }
  }
}

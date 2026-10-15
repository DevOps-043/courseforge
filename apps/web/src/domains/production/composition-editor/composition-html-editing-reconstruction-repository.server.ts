import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { readReviewedHtmlReconstructionHandoff } from "./composition-html-editing-reconstruction-handoff.server";
import { describeHtmlReconstructionCandidate, readHtmlReconstructionCandidate,
  type HtmlReconstructionCandidate } from "./composition-html-editing-reconstruction-candidate.server";
import { HTML_RECONSTRUCTION_POLICY as policy, htmlReconstructionReviewRecordSchema, htmlReconstructionStagingSchema,
  htmlReconstructionStagingAckSchema, htmlReconstructionStagingReadSchema, htmlReconstructionCreationReceiptSchema,
  htmlReconstructionCreationReadSchema, type HtmlReconstructionStaging } from "./composition-html-editing-reconstruction.contract";
import type { createHtmlEditingSnapshotArchiveStore } from "./composition-html-editing-snapshot-storage.server";

type StageInput = Parameters<typeof readReviewedHtmlReconstructionHandoff>[0] & {
  operationId: string; storeArchive: ReturnType<typeof createHtmlEditingSnapshotArchiveStore>;
  preserveStaging: (staging: HtmlReconstructionStaging, signal: AbortSignal) => Promise<HtmlReconstructionStaging>;
};
let activeStagings = 0;

/** Trusted private host only. The injected authority port must use independently
 * configured catalog/current backend resources. SQL owns the final atomic checks.
 * No automatic write retry, compensation, replacement or historical activation. */
export class HtmlReconstructionRepository {
  constructor(private readonly supabase: SupabaseClient,
    private readonly verifyCurrentAuthority: (candidate: HtmlReconstructionCandidate, signal: AbortSignal) => Promise<void>,
    private readonly preserveCreationIntent: (staging: HtmlReconstructionStaging, signal: AbortSignal) => Promise<HtmlReconstructionStaging>) {}

  async stage(input: StageInput) {
    input.signal?.throwIfAborted();
    if (activeStagings >= policy.maximumConcurrentPreparations) throw new Error("HTML_RECONSTRUCTION_STAGING_BUSY");
    activeStagings++;
    try {return await this.stageOwned(input);} finally {activeStagings--;}
  }

  private async stageOwned(input: StageInput) {
    const signal = this.signal(input.signal, policy.preparationTimeoutMs);
    const operationId = htmlReconstructionStagingSchema.shape.operationId.parse(input.operationId);
    const {storeArchive, preserveStaging} = input;
    const reviewed = await readReviewedHtmlReconstructionHandoff({...input, signal});
    const {archiveBytes: producerBytes, ...prepared} = reviewed.artifact.prepared;
    const archiveBytes = Buffer.from(producerBytes);
    if (createHash("sha256").update(archiveBytes).digest("hex") !== reviewed.locator.projectHash)
      throw new Error("HTML_RECONSTRUCTION_CANDIDATE_INVALID");
    const review = htmlReconstructionReviewRecordSchema.parse({scope: "RECONSTRUCTION_REVIEW_RECORD_NOT_CREATION_AUTHORITY",
      locator: reviewed.locator, origin: reviewed.artifact.candidate.origin, approval: reviewed.approval});
    const candidate = describeHtmlReconstructionCandidate({review, archiveSizeBytes: archiveBytes.length,
      content: {scope: reviewed.artifact.scope, candidate: reviewed.artifact.candidate, prepared}});
    const staging = htmlReconstructionStagingSchema.parse({scope: "RECONSTRUCTION_STAGING_NOT_CREATION_OR_PUBLICATION",
      operationId, review, candidateSha256: candidate.candidateSha256, archiveSizeBytes: archiveBytes.length});
    await this.authorize(candidate, signal);
    try {this.exact(await preserveStaging(structuredClone(staging), signal), staging);}
    catch {signal.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_JOURNAL_UNCONFIRMED");}
    signal.throwIfAborted();
    const ack = this.parse(htmlReconstructionStagingAckSchema, await this.rpc("record_html_reconstruction_staging", staging,
      {}, signal, policy.receiptBytes));
    this.exact(ack.staging, staging);
    // Claim must be new. A matching existing claim is NOT permission to upload
    // again or adopt an orphan after a crash; readStaging is the only recovery.
    if (!ack.created) throw new Error("HTML_RECONSTRUCTION_STAGING_ALREADY_ATTEMPTED_USE_RECOVERY");
    const uploadBytes = new Uint8Array(archiveBytes);
    const stored = await storeArchive({organizationId: review.locator.organizationId,
      compositionId: review.locator.targetCompositionId, projectHash: review.locator.projectHash,
      bytes: uploadBytes, contentType: "application/zip", signal});
    signal.throwIfAborted(); this.exact(stored, candidate.registration.archive);
    if (createHash("sha256").update(uploadBytes).digest("hex") !== staging.review.locator.projectHash)
      throw new Error("HTML_RECONSTRUCTION_STORAGE_ACK_INVALID");
    await this.authorize(candidate, signal);
    const recorded = await this.rpc("record_html_reconstruction_candidate", staging, {p_candidate: candidate}, signal, policy.receiptBytes);
    if (recorded !== true && recorded !== false) throw new Error("HTML_RECONSTRUCTION_CANDIDATE_UNCONFIRMED");
    return {staging, created: recorded};
  }

  /** Metadata-only query. NOT_FOUND or an unconfirmed candidate never starts a
   * second upload/write, adopts an orphan or creates from local bytes implicitly. */
  async readStaging(input: HtmlReconstructionStaging, authenticatedReviewerId: string, parent?: AbortSignal) {
    const staging = this.capture(input, authenticatedReviewerId), signal = this.signal(parent);
    const result = this.parse(htmlReconstructionStagingReadSchema,
      await this.rpc("read_html_reconstruction_staging", staging, {}, signal, policy.receiptBytes));
    if (result.status !== "NOT_FOUND") this.exact(result.staging, staging);
    return result;
  }

  async create(input: HtmlReconstructionStaging, authenticatedReviewerId: string, parent?: AbortSignal) {
    const staging = this.capture(input, authenticatedReviewerId), signal = this.signal(parent, policy.preparationTimeoutMs);
    const previous = await this.readCreation(staging, authenticatedReviewerId, signal);
    if (previous.status === "RECORDED") return previous.receipt;
    const candidate = readHtmlReconstructionCandidate(await this.rpc("read_html_reconstruction_candidate", staging,
      {}, signal, policy.registrationBytes));
    this.exact(candidate.review, staging.review);
    if (candidate.candidateSha256 !== staging.candidateSha256 || candidate.registration.archive.sizeBytes !== staging.archiveSizeBytes)
      throw new Error("HTML_RECONSTRUCTION_CANDIDATE_INVALID");
    await this.authorize(candidate, signal);
    try {this.exact(await this.preserveCreationIntent(structuredClone(staging), signal), staging);}
    catch {signal.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_JOURNAL_UNCONFIRMED");}
    signal.throwIfAborted();
    const receipt = this.parse(htmlReconstructionCreationReceiptSchema,
      await this.rpc("create_html_reconstruction", staging, {}, signal, policy.receiptBytes));
    this.exact(receipt.staging, staging);
    if (receipt.documentHash !== candidate.content.candidate.documentHash) throw new Error("HTML_RECONSTRUCTION_ACK_INVALID");
    return receipt;
  }

  /** A creation receipt records historical success, not current edit state,
   * render/publication or current resource authority. No compiler/Storage work. */
  async readCreation(input: HtmlReconstructionStaging, authenticatedReviewerId: string, parent?: AbortSignal) {
    const staging = this.capture(input, authenticatedReviewerId), signal = this.signal(parent);
    const result = this.parse(htmlReconstructionCreationReadSchema,
      await this.rpc("read_html_reconstruction_creation", staging, {}, signal, policy.receiptBytes));
    if (result.status === "RECORDED") this.exact(result.receipt.staging, staging);
    return result;
  }

  private capture(input: HtmlReconstructionStaging, reviewerId: string) {
    const staging = htmlReconstructionStagingSchema.parse(input);
    if (staging.review.approval.reviewerId !== reviewerId) throw new Error("HTML_RECONSTRUCTION_FORBIDDEN");
    return staging;
  }
  private async authorize(candidate: HtmlReconstructionCandidate, signal: AbortSignal) {
    try {await this.verifyCurrentAuthority(structuredClone(candidate), signal); signal.throwIfAborted();}
    catch {signal.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_CURRENT_AUTHORITY_UNAVAILABLE");}
  }
  private exact(actual: unknown, expected: unknown) {
    if (!isDeepStrictEqual(actual, expected)) throw new Error("HTML_RECONSTRUCTION_ACK_INVALID");
  }
  private parse<Schema extends z.ZodType>(schema: Schema, raw: unknown): z.infer<Schema> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new Error("HTML_RECONSTRUCTION_ACK_INVALID");
    return parsed.data;
  }
  private signal(parent?: AbortSignal, timeoutMs: number = policy.rpcTimeoutMs) {
    const timeout = AbortSignal.timeout(timeoutMs); return parent ? AbortSignal.any([parent, timeout]) : timeout;
  }
  private async rpc(name: string, staging: HtmlReconstructionStaging, extra: Record<string, unknown>, parent: AbortSignal, maximumBytes: number) {
    parent.throwIfAborted(); const signal = this.signal(parent);
    try {
      const response = await this.supabase.rpc(name, {p_org: staging.review.locator.organizationId,
        p_actor: staging.review.approval.reviewerId, p_staging: staging, ...extra}).abortSignal(signal);
      signal.throwIfAborted();
      if (response.error || response.data == null || Buffer.byteLength(JSON.stringify(response.data)) > maximumBytes) throw new Error();
      return response.data;
    } catch {parent.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_OPERATION_UNCONFIRMED");}
  }
}

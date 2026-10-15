import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readReviewedHtmlReconstructionHandoff } from "./composition-html-editing-reconstruction-handoff.server";
import { HTML_RECONSTRUCTION_POLICY as policy, htmlReconstructionReviewRecordSchema,
  htmlReconstructionReviewReadSchema, htmlReconstructionReviewAckSchema,
  type HtmlReconstructionReviewRecord } from "./composition-html-editing-reconstruction.contract";

/** Private host only, with an independently authenticated reviewer and service
 * client. Durable attestation is NOT current template/resource/create authority.
 * There is no Storage write, compiler, creation RPC, retry or HTTP route here. */
export class HtmlReconstructionReviewRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async recordReviewed(input: Parameters<typeof readReviewedHtmlReconstructionHandoff>[0]) {
    const signal = this.signal(input.signal);
    // That reader captures identities before its first await and verifies the
    // sealed local bytes. Never attest a browser-supplied metadata-only claim.
    const reviewed = await readReviewedHtmlReconstructionHandoff({...input, signal});
    signal.throwIfAborted();
    const record = htmlReconstructionReviewRecordSchema.parse({
      scope: "RECONSTRUCTION_REVIEW_RECORD_NOT_CREATION_AUTHORITY", locator: reviewed.locator,
      origin: reviewed.artifact.candidate.origin, approval: reviewed.approval,
    });
    const parsed = htmlReconstructionReviewAckSchema.safeParse(await this.rpc(
      "record_html_reconstruction_review", record, signal));
    if (!parsed.success) throw new Error("HTML_RECONSTRUCTION_REVIEW_ACK_INVALID");
    const acknowledgement = parsed.data;
    this.assertExact(acknowledgement.record, record);
    if (acknowledgement.revoked) throw new Error("HTML_RECONSTRUCTION_REVIEW_REVOKED");
    return acknowledgement;
  }

  /** Recovery is read-only, even for NOT_FOUND. It cannot distinguish an absent
   * record from an in-flight write, nor permit staging or another create. */
  async read(input: HtmlReconstructionReviewRecord, authenticatedReviewerId: string, parent?: AbortSignal) {
    const record = this.capture(input, authenticatedReviewerId), signal = this.signal(parent);
    const parsed = htmlReconstructionReviewReadSchema.safeParse(await this.rpc("read_html_reconstruction_review", record, signal));
    if (!parsed.success) throw new Error("HTML_RECONSTRUCTION_REVIEW_ACK_INVALID");
    const result = parsed.data;
    if (result.status === "RECORDED") this.assertExact(result.record, record);
    return result;
  }

  /** Explicit withdrawal only; the immutable attestation remains available for
   * reconciliation. A withdrawn review can never be reinstated by recordReviewed. */
  async revoke(input: HtmlReconstructionReviewRecord, authenticatedReviewerId: string, parent?: AbortSignal) {
    const record = this.capture(input, authenticatedReviewerId), signal = this.signal(parent);
    const parsed = htmlReconstructionReviewReadSchema.safeParse(await this.rpc("revoke_html_reconstruction_review", record, signal));
    if (!parsed.success) throw new Error("HTML_RECONSTRUCTION_REVIEW_ACK_INVALID");
    const result = parsed.data;
    if (result.status !== "RECORDED" || !result.revoked) throw new Error("HTML_RECONSTRUCTION_REVIEW_ACK_INVALID");
    this.assertExact(result.record, record);
    return result;
  }

  private capture(input: HtmlReconstructionReviewRecord, authenticatedReviewerId: string) {
    const record = htmlReconstructionReviewRecordSchema.parse(input);
    if (record.approval.reviewerId !== z.string().uuid().parse(authenticatedReviewerId))
      throw new Error("HTML_RECONSTRUCTION_REVIEW_FORBIDDEN");
    return record;
  }

  private assertExact(actual: HtmlReconstructionReviewRecord, expected: HtmlReconstructionReviewRecord) {
    if (!isDeepStrictEqual(actual, expected)) throw new Error("HTML_RECONSTRUCTION_REVIEW_ACK_INVALID");
  }

  private signal(parent?: AbortSignal) {
    const timeout = AbortSignal.timeout(policy.rpcTimeoutMs);
    return parent ? AbortSignal.any([parent, timeout]) : timeout;
  }

  private async rpc(name: string, record: HtmlReconstructionReviewRecord, signal: AbortSignal) {
    signal.throwIfAborted();
    if (Buffer.byteLength(JSON.stringify(record), "utf8") > policy.receiptBytes)
      throw new Error("HTML_RECONSTRUCTION_REVIEW_INVALID");
    try {
      const result = await this.supabase.rpc(name, {p_org: record.locator.organizationId,
        p_actor: record.approval.reviewerId, p_record: record}).abortSignal(signal);
      signal.throwIfAborted();
      if (result.error || result.data == null || Buffer.byteLength(JSON.stringify(result.data), "utf8") > policy.receiptBytes)
        throw new Error();
      return result.data;
    } catch {
      signal.throwIfAborted();
      // Never expose SQL, tenant details, paths or service client internals.
      throw new Error("HTML_RECONSTRUCTION_REVIEW_UNCONFIRMED");
    }
  }
}

import {createHash} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import {CompositionRenderAuthorityService} from "./composition-render-authority.service";
import {CONTROLLED_RENDER_STORAGE, controlledRenderObjectPath} from "./composition-controlled-render-storage-policy";
import {controlledWorkerLeaseArguments} from "./composition-controlled-render-worker-contract";

const bucket = CONTROLLED_RENDER_STORAGE.bucket;
const readTimeoutMilliseconds = 15 * 60 * 1000;
const signedUrlLifetimeSeconds = 20 * 60;
const maximumVideoBytes = CONTROLLED_RENDER_STORAGE.maximumVideoBytes;
const assetIdSchema = z.string().uuid();
type RecoveryInput = Parameters<CompositionRenderAuthorityService["recover"]>[0];

/** Host-only finalization of an already uploaded object. Upload and renderer execution remain separate. */
export class CompositionControlledRenderFinalizationService {
  private readonly authority: CompositionRenderAuthorityService;

  constructor(private readonly supabase: SupabaseClient<any, any, any>, private readonly supabaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch, clock: () => number = Date.now,private readonly workerLeaseToken?:string) {
    this.authority = new CompositionRenderAuthorityService(supabase, clock,workerLeaseToken);
  }

  async finalize(input: RecoveryInput & {signal?: AbortSignal}) {
    input.signal?.throwIfAborted();
    const verified = await this.authority.recover(input);
    const {binding, receiptSha256} = verified.provenance;
    const objectPath = controlledRenderObjectPath(binding);
    // Path and expected bytes are derived from freshly verified authority, never caller-selected metadata.
    await this.verifyStoredOutput(objectPath, binding.videoSha256, binding.sizeBytes, input.signal);
    const refreshed = await this.authority.recover(input);
    if (refreshed.provenance.receiptSha256 !== receiptSha256)
      throw new Error("CONTROLLED_RENDER_AUTHORITY_CHANGED");
    input.signal?.throwIfAborted();
    const publicUrl = new URL(`/storage/v1/object/public/${bucket}/${objectPath}`, this.supabaseUrl).href;
    const completed = await this.supabase.rpc("finalize_controlled_composition_render", {
      ...controlledWorkerLeaseArguments(this.workerLeaseToken),
      p_organization_id: binding.organizationId, p_request_id: binding.requestId,
      p_execution_id: binding.executionId, p_revision_id: binding.revisionId,
      p_production_job_id: binding.productionJobId, p_receipt_sha256: receiptSha256,
      p_video_sha256: binding.videoSha256, p_size_bytes: binding.sizeBytes,
      p_public_url: publicUrl,
    });
    const asset = assetIdSchema.safeParse(completed.data);
    if (completed.error || !asset.success) throw new Error("CONTROLLED_RENDER_FINALIZATION_REJECTED");
    return {assetId: asset.data, storageBucket: bucket, objectPath, checksum: binding.videoSha256,
      provenance: refreshed.provenance, conformanceApproved: false as const};
  }

  private async verifyStoredOutput(objectPath: string, expectedHash: string, expectedSize: number, signal?: AbortSignal) {
    const signed = await this.supabase.storage.from(bucket).createSignedUrl(objectPath, signedUrlLifetimeSeconds)
      .catch(() => {throw new Error("CONTROLLED_RENDER_STORAGE_UNAVAILABLE");});
    if (signed.error || !signed.data?.signedUrl) throw new Error("CONTROLLED_RENDER_STORAGE_UNAVAILABLE");
    const url = this.trustedSignedUrl(signed.data.signedUrl, objectPath);
    const timeout = AbortSignal.timeout(readTimeoutMilliseconds);
    const readSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    readSignal.throwIfAborted();
    try {
      const response = await this.fetchImpl(url, {signal: readSignal, redirect: "error", cache: "no-store"});
      const length = response.headers.get("content-length"), type = response.headers.get("content-type")?.split(";")[0].trim();
      if (response.status !== 200 || !response.body || response.headers.has("content-range")
        || (length !== null && length !== String(expectedSize))
        || (type !== undefined && type !== "video/mp4" && type !== "application/octet-stream")) {
        await response.body?.cancel();
        throw new Error("CONTROLLED_RENDER_STORAGE_RESPONSE_INVALID");
      }
      const reader = response.body.getReader(), digest = createHash("sha256");
      let size = 0;
      const cancelRead = () => {void reader.cancel().catch(() => undefined);};
      readSignal.addEventListener("abort", cancelRead, {once: true});
      try {
        while (true) {
          readSignal.throwIfAborted();
          const chunk = await reader.read();
          readSignal.throwIfAborted();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > expectedSize || size > maximumVideoBytes)
            throw new Error("CONTROLLED_RENDER_STORAGE_BYTES_MISMATCH");
          digest.update(chunk.value);
        }
        if (size !== expectedSize || digest.digest("hex") !== expectedHash)
          throw new Error("CONTROLLED_RENDER_STORAGE_BYTES_MISMATCH");
      } finally {
        readSignal.removeEventListener("abort", cancelRead);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof Error && /^CONTROLLED_RENDER_[A-Z_]+$/.test(error.message)) throw error;
      // Fetch failures can include signed credentials or provider internals.
      throw new Error("CONTROLLED_RENDER_STORAGE_READ_FAILED");
    }
  }

  private trustedSignedUrl(raw: string, objectPath: string) {
    try {
      const project = new URL(this.supabaseUrl), signed = new URL(raw);
      const expectedPath = `/storage/v1/object/sign/${bucket}/${objectPath}`;
      if (project.protocol !== "https:" || signed.origin !== project.origin || signed.username || signed.password
        || signed.pathname !== expectedPath || !signed.searchParams.get("token") || signed.hash)
        throw new Error();
      return signed.href;
    } catch {throw new Error("CONTROLLED_RENDER_STORAGE_URL_INVALID");}
  }
}

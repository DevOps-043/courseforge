import {open} from "node:fs/promises";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import {CompositionRenderAuthorityService} from "./composition-render-authority.service";
import {CompositionControlledRenderFinalizationService} from "./composition-controlled-render-finalization.service";
import {CONTROLLED_RENDER_STORAGE as policy, controlledRenderObjectPath, controlledRenderTusUrl} from "./composition-controlled-render-storage-policy";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";
import {controlledWorkerLeaseArguments} from "./composition-controlled-render-worker-contract";

type RecoveryInput = Parameters<CompositionRenderAuthorityService["recover"]>[0];
const sessionSchema = z.object({uploadUrl: z.string().nullable(), objectExists: z.boolean()}).strict();

/** Host-only: upload tokens remain in memory; durable ledger stores only the validated TUS URL. */
export class CompositionControlledRenderUploadService {
  private readonly authority: CompositionRenderAuthorityService;
  private readonly finalizer: CompositionControlledRenderFinalizationService;
  constructor(private readonly supabase: SupabaseClient<any, any, any>, private readonly projectUrl: string,
    private readonly fetchImpl: typeof fetch = fetch, clock: () => number = Date.now,private readonly workerLeaseToken?:string) {
    this.authority = new CompositionRenderAuthorityService(supabase, clock,workerLeaseToken);
    this.finalizer = new CompositionControlledRenderFinalizationService(supabase, projectUrl, fetchImpl, clock,workerLeaseToken);
  }

  async uploadAndFinalize(input: RecoveryInput & {signal?: AbortSignal}) {
    input.signal?.throwIfAborted();
    const recovered = await this.authority.recover(input), {binding, receiptSha256} = recovered.provenance;
    const objectPath = controlledRenderObjectPath(binding);
    const scope = {...controlledWorkerLeaseArguments(this.workerLeaseToken),p_organization_id: binding.organizationId, p_request_id: binding.requestId,
      p_execution_id: binding.executionId, p_receipt_sha256: receiptSha256};
    const saved = await this.supabase.rpc("read_controlled_render_upload", scope);
    const parsed = sessionSchema.safeParse(saved.data);
    if (saved.error || !parsed.success) throw new Error("CONTROLLED_RENDER_UPLOAD_SESSION_UNAVAILABLE");
    if (parsed.data.objectExists) return this.finalizer.finalize(input);
    const signed = await this.supabase.storage.from(policy.bucket).createSignedUploadUrl(objectPath, {upsert: false})
      .catch(() => {throw new Error("CONTROLLED_RENDER_UPLOAD_TOKEN_UNAVAILABLE");});
    if (signed.error || !signed.data?.token || signed.data.path !== objectPath)
      throw new Error("CONTROLLED_RENDER_UPLOAD_TOKEN_UNAVAILABLE");
    const endpoint = controlledRenderTusUrl("/storage/v1/upload/resumable", this.projectUrl, false);
    const headers = {"Tus-Resumable": "1.0.0", "x-signature": signed.data.token};
    let uploadUrl = parsed.data.uploadUrl === null ? null : controlledRenderTusUrl(parsed.data.uploadUrl, this.projectUrl, true);
    const request = async (url: string, init: RequestInit) => {
      input.signal?.throwIfAborted();
      const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(policy.requestTimeoutMilliseconds)])
        : AbortSignal.timeout(policy.requestTimeoutMilliseconds);
      try {return await this.fetchImpl(url, {...init, headers: {...headers, ...init.headers}, signal, redirect: "error"});}
      catch {throw new Error("CONTROLLED_RENDER_UPLOAD_TRANSPORT_FAILED");}
    };
    const checkpoint = async (previousUrl: string | null, nextUrl: string) => {
      input.signal?.throwIfAborted();
      const result = await this.supabase.rpc("save_controlled_render_upload", {...scope,
        p_expected_upload_url: previousUrl, p_upload_url: nextUrl});
      if (result.error || result.data !== true) throw new Error("CONTROLLED_RENDER_UPLOAD_CHECKPOINT_REJECTED");
    };
    let offset = 0;
    if (uploadUrl !== null) {
      const response = await request(uploadUrl, {method: "HEAD"});
      await response.body?.cancel();
      if (![404, 410].includes(response.status)) {
        if (response.status !== 200 && response.status !== 204) throw new Error("CONTROLLED_RENDER_UPLOAD_HEAD_FAILED");
        offset = this.readOffset(response, binding.sizeBytes);
        if (response.headers.get("upload-length") !== String(binding.sizeBytes))
          throw new Error("CONTROLLED_RENDER_UPLOAD_LENGTH_MISMATCH");
      } else {
        // Expired session may be recreated, but an existing completed object is never overwritten.
        offset = -1;
      }
    }
    if (uploadUrl === null || offset === -1) {
      const metadata = Object.entries({bucketName: policy.bucket, objectName: objectPath, contentType: "video/mp4", cacheControl: "3600"})
        .map(([name, value]) => `${name} ${Buffer.from(value).toString("base64")}`).join(",");
      const response = await request(endpoint, {method: "POST", headers: {"Upload-Length": String(binding.sizeBytes), "Upload-Metadata": metadata}});
      await response.body?.cancel();
      if (response.status !== 201 || !response.headers.get("location")) throw new Error("CONTROLLED_RENDER_UPLOAD_CREATE_FAILED");
      const nextUrl = controlledRenderTusUrl(new URL(response.headers.get("location")!, endpoint).href, this.projectUrl, true);
      await checkpoint(uploadUrl, nextUrl);
      uploadUrl = nextUrl; offset = 0;
    }
    const pin = await pinConformanceFile(input.videoPath, policy.maximumVideoBytes);
    if (pin.sha256 !== binding.videoSha256 || pin.sizeBytes !== binding.sizeBytes)
      throw new Error("CONTROLLED_RENDER_UPLOAD_SOURCE_CHANGED");
    const file = await open(input.videoPath, "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.dev !== pin.device || stat.ino !== pin.inode || stat.size !== pin.sizeBytes
        || stat.mtimeMs !== pin.modifiedAt || stat.ctimeMs !== pin.changedAt)
        throw new Error("CONTROLLED_RENDER_UPLOAD_SOURCE_CHANGED");
      while (offset < binding.sizeBytes) {
        // Refresh admission/revocation/cancellation through the scoped checkpoint before each transfer.
        await checkpoint(uploadUrl, uploadUrl);
        const bytes = Buffer.alloc(Math.min(policy.chunkBytes, binding.sizeBytes - offset));
        let filled = 0;
        while (filled < bytes.length) {
          const read = await file.read(bytes, filled, bytes.length - filled, offset + filled);
          if (!read.bytesRead) throw new Error("CONTROLLED_RENDER_UPLOAD_SOURCE_CHANGED");
          filled += read.bytesRead;
        }
        const response = await request(uploadUrl, {method: "PATCH", headers: {
          "Content-Type": "application/offset+octet-stream", "Upload-Offset": String(offset)}, body: bytes});
        await response.body?.cancel();
        if (response.status !== 204 || this.readOffset(response, binding.sizeBytes) !== offset + bytes.length)
          throw new Error("CONTROLLED_RENDER_UPLOAD_OFFSET_MISMATCH");
        offset += bytes.length;
      }
    } finally {await file.close();}
    await assertConformanceFileUnchanged(input.videoPath, pin, policy.maximumVideoBytes);
    return this.finalizer.finalize(input);
  }

  private readOffset(response: Response, size: number) {
    const raw = response.headers.get("upload-offset");
    if (!raw || !/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > size)
      throw new Error("CONTROLLED_RENDER_UPLOAD_OFFSET_MISMATCH");
    return Number(raw);
  }
}

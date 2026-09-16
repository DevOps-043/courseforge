import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getOrganizationHyperframesApiKey } from "../_shared/credentials.ts";
import { getHyperframesRender, HeygenHttpError } from "../_shared/heygen.ts";
import { importRetryDelaySeconds, isPermanentProviderFailure } from "../_shared/hyperframes-retry-policy.ts";
import { authorizeWorker, jsonResponse, logEvent, methodNotAllowed } from "../_shared/http.ts";
import { rpc } from "../_shared/supabase.ts";
import {
  appendTusChunk,
  createTusUpload,
  getPublicStorageUrl,
  MAX_FINAL_VIDEO_BYTES,
  readTusOffset,
  TUS_CHUNK_BYTES,
  TusUploadExpiredError,
  StorageHttpError,
} from "../_shared/tus.ts";

const CHUNKS_PER_INVOCATION = 4;
const ALLOWED_VIDEO_HOSTS = [
  "heygen.com",
  "heygen.ai",
  "cdn.heygen.com",
  "heygen-product.s3.amazonaws.com",
  "resource.heygen.com",
  "files2.heygen.ai",
] as const;

interface ImportClaim {
  artifact_id: string;
  attempt_count: number;
  component_id: string | null;
  created_by: string | null;
  failure_count: number;
  import_id: string;
  lease_token: string;
  organization_id: string;
  production_job_id: string;
  provider_render_id: string;
  request_id: string;
  source_content_type: string | null;
  source_size_bytes: number | null;
  storage_bucket: string;
  storage_path: string | null;
  tus_upload_url: string | null;
  uploaded_bytes: number;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return methodNotAllowed();
  const unauthorized = authorizeWorker(request);
  if (unauthorized) return unauthorized;

  try {
    const claims = await rpc<ImportClaim[]>("claim_hyperframes_render_imports", {
      p_lease_seconds: 360,
      p_limit: 2,
    });
    const results = await Promise.allSettled(claims.map(processImport));
    const failed = results.filter((result) => result.status === "rejected").length;
    logEvent(failed ? "warn" : "info", "hyperframes_import_batch", {
      claimed: claims.length,
      failed,
      succeeded: claims.length - failed,
    });
    return jsonResponse({ claimed: claims.length, failed });
  } catch (error) {
    logEvent("error", "hyperframes_import_batch_failed", { message: safeMessage(error) });
    return jsonResponse({ error: "import_failed" }, 500);
  }
});

async function processImport(claim: ImportClaim): Promise<void> {
  let stage = "credentials";
  try {
    const apiKey = await getOrganizationHyperframesApiKey(claim.organization_id);
    stage = "provider_status";
    const detail = await getHyperframesRender(apiKey, claim.provider_render_id);
    if (detail.status !== "completed" || !detail.video_url) {
      throw new RetryableImportError("HeyGen render is not ready for import.");
    }
    if (!claim.component_id) {
      throw new TerminalImportError("The render request is not linked to a material component.");
    }
    assertSafeVideoUrl(detail.video_url);

    stage = "source_probe";
    const source = await probeSource(detail.video_url, detail.format);
    if (source.size > MAX_FINAL_VIDEO_BYTES) throw new TerminalImportError("Final video exceeds the 2 GiB storage limit.");
    if (claim.source_size_bytes && claim.source_size_bytes !== source.size) {
      throw new TerminalImportError("HeyGen video size changed during resumable import.");
    }
    const extension = source.contentType === "video/webm" ? "webm"
      : source.contentType === "video/quicktime" ? "mov"
      : "mp4";
    const objectPath = claim.storage_path || [
      "organizations", claim.organization_id, "artifacts", claim.artifact_id,
      "components", claim.component_id, "renders", claim.request_id, `final.${extension}`,
    ].join("/");
    const createUpload = () => createTusUpload({
      bucket: claim.storage_bucket,
      contentType: source.contentType,
      objectPath,
      size: source.size,
    });
    stage = "storage_upload";
    let uploadUrl = claim.tus_upload_url || await createUpload();
    let offset: number;
    try {
      offset = await readTusOffset(uploadUrl);
    } catch (error) {
      if (!(error instanceof TusUploadExpiredError)) throw error;
      uploadUrl = await createUpload();
      offset = 0;
    }
    if (offset > source.size) throw new TerminalImportError("Storage offset exceeds the source size.");

    // Persist the upload location before transferring bytes. A timeout must not
    // lose the resumable upload, and each checkpoint also checks cancellation.
    const checkpoint = () => rpc<void>("save_hyperframes_import_progress", {
      p_import_id: claim.import_id, p_lease_token: claim.lease_token,
      p_source_content_type: source.contentType, p_source_size_bytes: source.size,
      p_storage_path: objectPath, p_tus_upload_url: uploadUrl, p_uploaded_bytes: offset,
    });
    stage = "checkpoint";
    await checkpoint();
    for (let chunkIndex = 0; chunkIndex < CHUNKS_PER_INVOCATION && offset < source.size; chunkIndex += 1) {
      stage = "source_download";
      const end = Math.min(offset + TUS_CHUNK_BYTES, source.size) - 1;
      const bytes = await downloadRange(detail.video_url, offset, end, source.size);
      stage = "storage_chunk";
      offset = await appendTusChunk(uploadUrl, offset, bytes);
      stage = "checkpoint";
      await checkpoint();
    }

    if (offset === source.size) {
      stage = "finalizing";
      await rpc<string>("complete_hyperframes_render_import", {
        p_duration_seconds: detail.duration || null,
        p_import_id: claim.import_id,
        p_lease_token: claim.lease_token,
        p_public_url: getPublicStorageUrl(claim.storage_bucket, objectPath),
      });
      logEvent("info", "hyperframes_import_completed", {
        bytes: source.size,
        requestId: claim.request_id,
      });
      return;
    }

    // Release the lease quickly; the next cron invocation resumes using a TUS HEAD.
    await rpc<void>("release_hyperframes_import_checkpoint", {
      p_import_id: claim.import_id,
      p_lease_token: claim.lease_token,
      p_retry_after_seconds: 15,
    });
  } catch (error) {
    const terminal = error instanceof TerminalImportError || claim.failure_count >= 8
      || (error instanceof HeygenHttpError && isPermanentProviderFailure(error.status))
      || (error instanceof StorageHttpError && isPermanentProviderFailure(error.status));
    try {
      await rpc<void>("reschedule_hyperframes_render_import", {
        p_error_message: `[${stage}] ${safeMessage(error)}`,
        p_import_id: claim.import_id,
        p_lease_token: claim.lease_token,
        p_retry_after_seconds: importRetryDelaySeconds(claim.failure_count),
        p_terminal: terminal,
      });
    } catch (rescheduleError) {
      logEvent("error", "hyperframes_import_reschedule_failed", {
        importId: claim.import_id,
        message: safeMessage(rescheduleError),
      });
    }
    throw error;
  }
}

async function probeSource(
  url: string,
  providerFormat?: "mp4" | "webm" | "mov",
): Promise<{ contentType: string; size: number }> {
  const response = await fetch(url, {
    headers: { Accept: "video/mp4,video/webm,video/quicktime", Range: "bytes=0-0" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const contentType = normalizeContentType(response.headers.get("content-type"), url, providerFormat);
  const contentRange = response.headers.get("content-range") || "";
  const rangeMatch = /^bytes 0-0\/(\d+)$/.exec(contentRange);
  const contentLength = Number(response.headers.get("content-length"));
  const size = rangeMatch ? Number(rangeMatch[1]) : contentLength;
  await response.body?.cancel();
  if (!response.ok || !Number.isSafeInteger(size) || size <= 0) {
    throw new RetryableImportError("Could not determine HeyGen video size.");
  }
  if (response.status !== 206 && size > TUS_CHUNK_BYTES) {
    throw new TerminalImportError("HeyGen video host does not support safe ranged downloads.");
  }
  return { contentType, size };
}

async function downloadRange(url: string, start: number, end: number, total: number): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { Accept: "video/mp4,video/webm,video/quicktime", Range: `bytes=${start}-${end}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const expectedLength = end - start + 1;
  if (!response.ok || (response.status !== 206 && !(start === 0 && expectedLength === total))) {
    await response.body?.cancel();
    throw new RetryableImportError(`HeyGen range download failed (${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== expectedLength) throw new RetryableImportError("HeyGen returned an incomplete video range.");
  return bytes;
}

function assertSafeVideoUrl(rawUrl: string): void {
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !ALLOWED_VIDEO_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    throw new TerminalImportError("HeyGen returned an untrusted video URL.");
  }
}

function normalizeContentType(
  header: string | null,
  url: string,
  providerFormat?: "mp4" | "webm" | "mov",
): string {
  const contentType = (header || "").split(";", 1)[0]!.trim().toLowerCase();
  if (["video/mp4", "video/webm", "video/quicktime"].includes(contentType)) return contentType;
  if (contentType === "application/octet-stream") {
    if (providerFormat === "webm") return "video/webm";
    if (providerFormat === "mov") return "video/quicktime";
    if (providerFormat === "mp4") return "video/mp4";
    return url.toLowerCase().includes(".webm") ? "video/webm"
      : url.toLowerCase().includes(".mov") ? "video/quicktime"
      : "video/mp4";
  }
  throw new TerminalImportError("HeyGen returned an unsupported final-video content type.");
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown import error").slice(0, 500);
}

class RetryableImportError extends Error {}
class TerminalImportError extends Error {}

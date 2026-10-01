import { createHash, timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";

const FINAL_VIDEO_BUCKET = "production-videos";
const MAX_FINAL_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const STORAGE_READ_TIMEOUT_MS = 15 * 60 * 1_000;

export async function hashStoredVideoResponse(response: Response, expectedSizeBytes: number,
  consumeChunk?: (chunk: Uint8Array) => Promise<void>): Promise<string> {
  if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes <= 0 || expectedSizeBytes > MAX_FINAL_VIDEO_BYTES) {
    throw new Error("VIDEO_INTEGRITY_SIZE_INVALID");
  }
  if (response.status !== 200 || !response.body || response.headers.has("content-range")) {
    await response.body?.cancel();
    throw new Error("VIDEO_INTEGRITY_STORAGE_RESPONSE_INVALID");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && declaredLength !== String(expectedSizeBytes)) {
    await response.body.cancel();
    throw new Error("VIDEO_INTEGRITY_LENGTH_MISMATCH");
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
  if (contentType && contentType !== "video/mp4" && contentType !== "application/octet-stream") {
    await response.body.cancel();
    throw new Error("VIDEO_INTEGRITY_CONTENT_TYPE_INVALID");
  }
  const digest = createHash("sha256");
  const reader = response.body.getReader();
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > expectedSizeBytes) throw new Error("VIDEO_INTEGRITY_OVERSIZED_BODY");
      digest.update(value);
      if (consumeChunk) await consumeChunk(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (receivedBytes !== expectedSizeBytes) throw new Error("VIDEO_INTEGRITY_TRUNCATED_BODY");
  return digest.digest("hex");
}

export function assertTrustedSignedVideoUrl(rawUrl: string, supabaseUrl: string, objectPath: string): void {
  const url = new URL(rawUrl);
  const project = new URL(supabaseUrl);
  const projectMatch = /^([a-z0-9-]+)\.supabase\.co$/i.exec(project.hostname);
  const storageOrigin = projectMatch ? `https://${projectMatch[1]}.storage.supabase.co` : project.origin;
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const expectedPath = `/storage/v1/object/sign/${FINAL_VIDEO_BUCKET}/${encodedPath}`;
  const localDevelopment = project.protocol === "http:" && ["127.0.0.1", "localhost"].includes(project.hostname);
  if ((url.protocol !== "https:" && !(localDevelopment && url.origin === project.origin))
    || ![project.origin, storageOrigin].includes(url.origin)
    || url.pathname !== expectedPath || !url.searchParams.has("token") || url.username || url.password) {
    throw new Error("VIDEO_INTEGRITY_SIGNED_URL_INVALID");
  }
}

type VideoIntegrityInput = {
  fetchImpl?: typeof fetch;
  organizationId: string;
  requestId: string;
  supabase: SupabaseClient<any, any, any>;
  supabaseUrl: string;
};

export function assertUnchangedVideoChecksum(recordedChecksum: unknown, integrityMethod: unknown, actualChecksum: string): void {
  if (integrityMethod !== "storage-stream-sha256-v1" || typeof recordedChecksum !== "string"
    || !/^[a-f0-9]{64}$/.test(recordedChecksum) || !/^[a-f0-9]{64}$/.test(actualChecksum)) {
    throw new Error("VIDEO_INTEGRITY_NOT_VERIFIED");
  }
  if (!timingSafeEqual(Buffer.from(recordedChecksum, "hex"), Buffer.from(actualChecksum, "hex"))) {
    throw new Error("VIDEO_INTEGRITY_OVERWRITTEN");
  }
}

export async function checkImportedHyperframesVideo(params: VideoIntegrityInput) {
  const video = await readImportedHyperframesVideo(params, true);
  assertUnchangedVideoChecksum(video.recordedChecksum, video.integrityMethod, video.checksum);
  return { assetId: video.assetId, checksum: video.checksum, documentHash: video.documentHash, sizeBytes: video.sizeBytes, status: "MATCH" as const };
}

/** Worker-owned destination only. Caller cleans this file even if remote verification fails. */
export async function snapshotImportedHyperframesVideo(params: VideoIntegrityInput & { destinationPath: string }) {
  const destination = await open(params.destinationPath, "wx", 0o600);
  try {
    const video = await readImportedHyperframesVideo(params, true, (chunk) => destination.writeFile(chunk));
    assertUnchangedVideoChecksum(video.recordedChecksum, video.integrityMethod, video.checksum);
    return { assetId: video.assetId, checksum: video.checksum, documentHash: video.documentHash,
      sizeBytes: video.sizeBytes, status: "MATCH" as const };
  } finally { await destination.close(); }
}

export async function verifyImportedHyperframesVideo(params: VideoIntegrityInput) {
  const video = await readImportedHyperframesVideo(params, false);
  if (video.recordedChecksum) {
    if (typeof video.recordedChecksum !== "string" || !/^[a-f0-9]{64}$/.test(video.recordedChecksum)) {
      throw new Error("VIDEO_INTEGRITY_RECORDED_CHECKSUM_INVALID");
    }
    if (!timingSafeEqual(Buffer.from(video.recordedChecksum, "hex"), Buffer.from(video.checksum, "hex"))) {
      throw new Error("VIDEO_INTEGRITY_OVERWRITTEN");
    }
  }
  const { data: recordedAssetId, error: recordError } = await params.supabase.rpc("record_hyperframes_final_video_checksum", {
    p_asset_id: video.assetId,
    p_checksum: video.checksum,
    p_file_size_bytes: video.sizeBytes,
    p_organization_id: params.organizationId,
    p_request_id: params.requestId,
  });
  if (recordError) throw recordError;
  if (recordedAssetId !== video.assetId) throw new Error("VIDEO_INTEGRITY_RECORD_MISMATCH");
  return { assetId: video.assetId, checksum: video.checksum, documentHash: video.documentHash, sizeBytes: video.sizeBytes };
}

async function readImportedHyperframesVideo(params: VideoIntegrityInput, requireVerifiedChecksum: boolean,
  consumeChunk?: (chunk: Uint8Array) => Promise<void>) {
  const { data: request, error: requestError } = await params.supabase.from("hyperframes_render_requests")
    .select("id, organization_id, production_job_id, composition_revision_id, provider_render_id, provider_status, import_status")
    .eq("id", params.requestId).eq("organization_id", params.organizationId).maybeSingle();
  if (requestError) throw requestError;
  if (!request || request.provider_status !== "COMPLETED" || request.import_status !== "COMPLETED") {
    throw new Error("VIDEO_INTEGRITY_RENDER_NOT_COMPLETED");
  }
  const [jobResult, assetResult, revisionResult] = await Promise.all([
    params.supabase.from("production_jobs")
      .select("id, artifact_id, material_component_id, organization_id, status, input_snapshot, output_snapshot")
      .eq("id", request.production_job_id).eq("organization_id", params.organizationId).maybeSingle(),
    params.supabase.from("production_assets")
      .select("id, organization_id, production_job_id, provider, asset_type, metadata, mime_type, file_size_bytes, storage_bucket, storage_path, checksum")
      .eq("production_job_id", request.production_job_id).eq("organization_id", params.organizationId)
      .eq("asset_type", "FINAL_VIDEO").maybeSingle(),
    params.supabase.from("video_composition_revisions")
      .select("id, organization_id, project_hash, manifest")
      .eq("id", request.composition_revision_id).eq("organization_id", params.organizationId).maybeSingle(),
  ]);
  if (jobResult.error) throw jobResult.error;
  if (assetResult.error) throw assetResult.error;
  if (revisionResult.error) throw revisionResult.error;
  const job = jobResult.data;
  const asset = assetResult.data;
  const revision = revisionResult.data;
  const documentHash = revision?.manifest?.conformance_contract?.documentHash;
  if (!job || !asset || !revision || job.status !== "SUCCEEDED" || !job.material_component_id
    || job.input_snapshot?.revision_id !== revision.id
    || job.input_snapshot?.project_hash !== revision.project_hash
    || typeof documentHash !== "string" || !/^[a-f0-9]{64}$/.test(documentHash)
    || revision.manifest?.draft_document_hash !== documentHash
    || asset.production_job_id !== job.id || asset.provider !== "hyperframes"
    || asset.metadata?.render_request_id !== request.id || asset.metadata?.provider_render_id !== request.provider_render_id
    || job.output_snapshot?.final_video?.asset_id !== asset.id
    || asset.storage_bucket !== FINAL_VIDEO_BUCKET || asset.mime_type !== "video/mp4") {
    throw new Error("VIDEO_INTEGRITY_LINEAGE_MISMATCH");
  }
  const expectedPath = `organizations/${params.organizationId}/artifacts/${job.artifact_id}/components/${job.material_component_id}/renders/${params.requestId}/final.mp4`;
  if (asset.storage_path !== `${FINAL_VIDEO_BUCKET}/${expectedPath}`) throw new Error("VIDEO_INTEGRITY_LINEAGE_MISMATCH");
  const sizeBytes = Number(asset.file_size_bytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FINAL_VIDEO_BYTES) {
    throw new Error("VIDEO_INTEGRITY_SIZE_INVALID");
  }
  if (requireVerifiedChecksum && (asset.metadata?.integrity_method !== "storage-stream-sha256-v1"
    || typeof asset.checksum !== "string" || !/^[a-f0-9]{64}$/.test(asset.checksum))) {
    throw new Error("VIDEO_INTEGRITY_NOT_VERIFIED");
  }
  const { data: signed, error: signError } = await params.supabase.storage
    .from(FINAL_VIDEO_BUCKET).createSignedUrl(expectedPath, 900);
  if (signError || !signed?.signedUrl) throw signError || new Error("VIDEO_INTEGRITY_SIGN_FAILED");
  assertTrustedSignedVideoUrl(signed.signedUrl, params.supabaseUrl, expectedPath);
  const response = await (params.fetchImpl || fetch)(signed.signedUrl, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(STORAGE_READ_TIMEOUT_MS),
  });
  const checksum = await hashStoredVideoResponse(response, sizeBytes, consumeChunk);
  return {
    assetId: asset.id,
    checksum,
    documentHash: documentHash as string,
    integrityMethod: asset.metadata?.integrity_method,
    recordedChecksum: asset.checksum as unknown,
    sizeBytes,
  };
}

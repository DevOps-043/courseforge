import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HYPERFRAMES_SOURCE_BUCKETS } from "../../media-storage.config";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "../../hyperframes/hyperframes.types";
import { materializeConformanceReference } from "./composition-conformance-materialization";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";

export const CONFORMANCE_STORAGE_READ_TIMEOUT_MS = 15 * 60 * 1000;

const revisionSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), composition_id: z.string().uuid(),
  project_hash: z.string().regex(/^[a-f0-9]{64}$/), project_archive_size_bytes: z.number().int().positive().max(HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES),
  project_storage_bucket: z.literal("production-assets"), project_storage_path: z.string(),
  manifest: z.object({ conformance_reference_version: z.literal(1) }).passthrough(),
}).passthrough();

export function assertConformanceStorageUrl(rawUrl: string, supabaseUrl: string, bucket: string, objectPath: string) {
  const project = new URL(supabaseUrl); const url = new URL(rawUrl);
  const hosted = /^([a-z0-9-]+)\.supabase\.co$/i.exec(project.hostname);
  const storageOrigin = hosted ? `https://${hosted[1]}.storage.supabase.co` : project.origin;
  const local = project.protocol === "http:" && ["127.0.0.1", "localhost"].includes(project.hostname);
  const expectedPath = `/storage/v1/object/sign/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
  if ((!HYPERFRAMES_SOURCE_BUCKETS.has(bucket)) || !objectPath || objectPath.startsWith("/") || objectPath.includes("..") || objectPath.includes("\\")
    || url.username || url.password || (url.protocol !== "https:" && !(local && url.origin === project.origin))
    || ![project.origin, storageOrigin].includes(url.origin) || url.pathname !== expectedPath || !url.searchParams.get("token")) {
    throw new Error("CONFORMANCE_MATERIALIZATION_STORAGE_URL_INVALID");
  }
}

/** Internal worker adapter. Caller must authorize organization scope before using service-role credentials. */
export async function materializeAuthorizedConformanceRevision(params: {
  supabase: SupabaseClient<any, any, any>; supabaseUrl: string; organizationId: string; revisionId: string;
  outputParentDirectory: string; fetchImpl?: typeof fetch; signal?: AbortSignal;
}) {
  assertConformanceJobActive(params.signal);
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort(new Error("CONFORMANCE_JOB_EXECUTION_CANCELLED"));
  params.signal?.addEventListener("abort", cancel, {once: true});
  if (params.signal?.aborted) cancel();
  const timeout = setTimeout(() => cancellation.abort(new Error("CONFORMANCE_MATERIALIZATION_DEADLINE_EXCEEDED")),
    CONFORMANCE_STORAGE_READ_TIMEOUT_MS);
  const assertActive = () => {
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
  };
  try {return await materializeActiveRevision({...params, signal: cancellation.signal});}
  catch (error) {assertActive(); throw error;}
  finally {clearTimeout(timeout); params.signal?.removeEventListener("abort", cancel);}
}

async function materializeActiveRevision(params: Parameters<typeof materializeAuthorizedConformanceRevision>[0]
  & {signal: AbortSignal}): Promise<Awaited<ReturnType<typeof materializeConformanceReference>>> {
  const assertActive = () => {if (params.signal.aborted) throw params.signal.reason;};
  z.string().uuid().parse(params.organizationId); z.string().uuid().parse(params.revisionId);
  assertActive();
  const { data, error } = await params.supabase.from("video_composition_revisions")
    .select("id, organization_id, composition_id, project_hash, project_archive_size_bytes, project_storage_bucket, project_storage_path, manifest")
    .eq("id", params.revisionId).eq("organization_id", params.organizationId).maybeSingle();
  assertActive();
  if (error || !data) throw new Error("CONFORMANCE_MATERIALIZATION_REVISION_UNAVAILABLE");
  const revision = revisionSchema.parse(data);
  if (revision.id !== params.revisionId || revision.organization_id !== params.organizationId
    || revision.project_storage_path !== `composition-snapshots/${params.organizationId}/${revision.composition_id}/${revision.project_hash}.zip`) {
    throw new Error("CONFORMANCE_MATERIALIZATION_REVISION_MISMATCH");
  }
  const readObject = async (bucket: string, storedPath: string) => {
    assertActive();
    const objectPath = storedPath.startsWith(`${bucket}/`) ? storedPath.slice(bucket.length + 1) : storedPath;
    if (!HYPERFRAMES_SOURCE_BUCKETS.has(bucket) || !objectPath || objectPath.includes("..") || objectPath.includes("\\") || objectPath.startsWith("/")) {
      throw new Error("CONFORMANCE_MATERIALIZATION_STORAGE_PATH_INVALID");
    }
    const { data: signed, error: signError } = await params.supabase.storage.from(bucket).createSignedUrl(objectPath, 900);
    assertActive();
    if (signError || !signed?.signedUrl) throw new Error("CONFORMANCE_MATERIALIZATION_SIGN_FAILED");
    assertConformanceStorageUrl(signed.signedUrl, params.supabaseUrl, bucket, objectPath);
    const response = await (params.fetchImpl ?? fetch)(signed.signedUrl, {redirect: "error", signal: params.signal});
    if (params.signal.aborted) {
      try {await response.body?.cancel();} catch { /* Keep the canonical cancellation reason. */ }
      assertActive();
    }
    return response;
  };
  const response = await readObject(revision.project_storage_bucket, revision.project_storage_path);
  if (response.status !== 200 || !response.body || response.headers.has("content-range")
    || response.headers.get("content-length") !== null && response.headers.get("content-length") !== String(revision.project_archive_size_bytes)) {
    await response.body?.cancel(); throw new Error("CONFORMANCE_MATERIALIZATION_ARCHIVE_RESPONSE_INVALID");
  }
  const chunks: Buffer[] = []; let bytes = 0; const reader = response.body.getReader();
  const cancelRead = () => {void reader.cancel().catch(() => {});};
  params.signal.addEventListener("abort", cancelRead, {once: true});
  try {
    assertActive();
    while (true) {
      const chunk = await reader.read(); assertActive(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > revision.project_archive_size_bytes) throw new Error("CONFORMANCE_MATERIALIZATION_ARCHIVE_SIZE_MISMATCH");
      chunks.push(Buffer.from(chunk.value));
    }
  } catch (error) {try {await reader.cancel();} catch { /* Preserve primary failure. */ } throw error; }
  finally {params.signal.removeEventListener("abort", cancelRead); reader.releaseLock();}
  if (bytes !== revision.project_archive_size_bytes) throw new Error("CONFORMANCE_MATERIALIZATION_ARCHIVE_SIZE_MISMATCH");
  const archiveBytes = Buffer.concat(chunks); chunks.length = 0;
  assertActive();
  return await materializeConformanceReference({
    archiveBytes, expectedProjectHash: revision.project_hash,
    organizationId: params.organizationId, revisionId: params.revisionId, outputParentDirectory: params.outputParentDirectory,
    readAsset: (binding) => readObject(binding.storageBucket, binding.storagePath),
    signal: params.signal,
  });
}

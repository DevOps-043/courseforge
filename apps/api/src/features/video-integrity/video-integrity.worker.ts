import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifyImportedHyperframesVideo } from "./video-integrity.service";

const claimSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), request_id: z.string().uuid(),
  lease_token: z.string().uuid(), attempts: z.number().int().min(1).max(5),
}).strict();
const resultSchema = z.object({
  assetId: z.string().uuid(), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
}).strict();
const permanentCodes = new Set([
  "VIDEO_INTEGRITY_LINEAGE_MISMATCH", "VIDEO_INTEGRITY_SIZE_INVALID", "VIDEO_INTEGRITY_SIGNED_URL_INVALID",
  "VIDEO_INTEGRITY_OVERWRITTEN", "VIDEO_INTEGRITY_RECORDED_CHECKSUM_INVALID", "VIDEO_INTEGRITY_RECORD_MISMATCH",
  "VIDEO_INTEGRITY_AUTHORITY_REJECTED",
]);

export function classifyVideoIntegrityFailure(error: unknown) {
  const code = error instanceof Error && /^VIDEO_INTEGRITY_[A-Z_]+$/.test(error.message)
    ? error.message : "VIDEO_INTEGRITY_WORKER_FAILED";
  return { code, retryable: !permanentCodes.has(code) };
}

export async function processVideoIntegrityJob(
  supabase: SupabaseClient<any, any, any>, supabaseUrl: string,
  verify: typeof verifyImportedHyperframesVideo = verifyImportedHyperframesVideo,
) {
  const { data, error } = await supabase.rpc("claim_hyperframes_video_integrity_job");
  if (error) throw new Error("VIDEO_INTEGRITY_CLAIM_FAILED");
  const claims = z.array(claimSchema).max(1).parse(data);
  if (!claims.length) return { status: "IDLE" as const };
  const claim = claims[0]!;
  let result: z.infer<typeof resultSchema> | null = null;
  let failure: ReturnType<typeof classifyVideoIntegrityFailure> | null = null;
  try {
    result = resultSchema.parse(await verify({
      organizationId: claim.organization_id, requestId: claim.request_id, supabase, supabaseUrl,
    }));
  } catch (error) { failure = classifyVideoIntegrityFailure(error); }
  // A lost acknowledgement is not rewritten as an execution failure: the lease can safely expire.
  const finished = await supabase.rpc("finish_hyperframes_video_integrity_job", {
    p_job_id: claim.id, p_lease_token: claim.lease_token, p_result: result,
    p_error_code: failure?.code ?? null, p_retryable: failure?.retryable ?? false,
  });
  if (finished.error) throw new Error("VIDEO_INTEGRITY_FINISH_FAILED");
  return {
    jobId: claim.id, requestId: claim.request_id, attempt: claim.attempts,
    status: finished.data !== true ? "LEASE_LOST" as const : failure ? "FAILED_ATTEMPT" as const : "SUCCEEDED" as const,
    errorCode: failure?.code ?? null,
  };
}

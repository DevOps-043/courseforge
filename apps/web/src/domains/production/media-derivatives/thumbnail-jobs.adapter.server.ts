import { createHash } from "node:crypto";
import { z } from "zod";
import { thumbnailSpriteCacheKey, thumbnailSpriteIdentitySchema, type ThumbnailSpriteIdentity } from "./thumbnail-derivative.contract";
import { thumbnailAccessSchema, rejectThumbnail, requireThumbnailActive, ThumbnailDerivativeError,
  withThumbnailDeadline, type ContainedThumbnailRuntime, type ThumbnailAccess, type ThumbnailAuthority,
  type ThumbnailManifest, type ThumbnailStore } from "./thumbnail-runtime.contract";
import { resolveThumbnailSource } from "./thumbnail-reader.server";
import { produceThumbnailSprite } from "./thumbnail-producer.server";

export const thumbnailClaimSchema = z.object({
  jobId: z.string().uuid(), leaseToken: z.string().uuid(), attempt: z.number().int().min(1).max(5),
  access: thumbnailAccessSchema, identity: thumbnailSpriteIdentitySchema,
}).strict().refine((claim) => claim.access.organizationId === claim.identity.source.organizationId);
export type ThumbnailClaim = z.infer<typeof thumbnailClaimSchema>;
type LeaseState = "RUNNING" | "CANCELLED" | "LEASE_LOST";

/** Core wraps production_jobs; this module owns no queue, retry loop, claim or persistence. */
export interface ThumbnailProductionJobsPort {
  createOrReuse(request: { access: ThumbnailAccess; identity: ThumbnailSpriteIdentity; idempotencyKey: string }, signal: AbortSignal): Promise<{
    jobId: string; organizationId: string; idempotencyKey: string;
  }>;
  /** Also renews the existing lease; CANCELLED/LEASE_LOST never grant publication. */
  heartbeat(claim: ThumbnailClaim, signal: AbortSignal): Promise<LeaseState>;
  /** Writes must be fenced on current tenant/job/attempt/lease and current cancellation state. */
  storeForClaim(claim: ThumbnailClaim): ThumbnailStore;
  /** Atomically checks current lease, cancellation, source grant and the exact verified cache record. */
  complete(claim: ThumbnailClaim, manifest: ThumbnailManifest, signal: AbortSignal): Promise<boolean>;
  fail(claim: ThumbnailClaim, code: string, signal: AbortSignal): Promise<boolean>;
  /** Durable cancellation of this tenant/component's job; never cancel another component's cache consumer. */
  cancel(request: { access: ThumbnailAccess; identity: ThumbnailSpriteIdentity; idempotencyKey: string }, signal: AbortSignal): Promise<boolean>;
}

export function thumbnailJobIdempotencyKey(access: ThumbnailAccess, identity: ThumbnailSpriteIdentity) {
  const scope = thumbnailAccessSchema.parse(access);
  const key = thumbnailSpriteCacheKey(identity);
  if (scope.organizationId !== identity.source.organizationId) rejectThumbnail("THUMBNAIL_ACCESS_DENIED");
  // Actor is excluded: requests from authorized collaborators reuse the same component job.
  const digest = createHash("sha256").update(JSON.stringify([scope.organizationId, scope.componentId, scope.sourceAssetId, key])).digest("hex");
  return `THUMBNAIL_SPRITE_GENERATION:ffmpeg:${scope.componentId}:${digest}`;
}

export async function requestThumbnailJob(params: {
  access: ThumbnailAccess; identity: ThumbnailSpriteIdentity; authority: ThumbnailAuthority;
  jobs: ThumbnailProductionJobsPort; signal: AbortSignal;
}) {
  return withThumbnailDeadline(params.signal, async (signal) => {
    const access = thumbnailAccessSchema.parse(params.access);
    const identity = thumbnailSpriteIdentitySchema.parse(params.identity);
    await resolveThumbnailSource(params.authority, access, identity, signal);
    const idempotencyKey = thumbnailJobIdempotencyKey(access, identity);
    const job = await params.jobs.createOrReuse({ access, identity, idempotencyKey }, signal);
    requireThumbnailActive(signal);
    if (!z.string().uuid().safeParse(job.jobId).success || job.organizationId !== access.organizationId
      || job.idempotencyKey !== idempotencyKey) rejectThumbnail("THUMBNAIL_JOB_BINDING_MISMATCH");
    return { jobId: job.jobId };
  });
}

export async function cancelThumbnailJob(params: {
  access: ThumbnailAccess; identity: ThumbnailSpriteIdentity; authority: ThumbnailAuthority;
  jobs: ThumbnailProductionJobsPort; signal: AbortSignal;
}) {
  return withThumbnailDeadline(params.signal, async (signal) => {
    const access = thumbnailAccessSchema.parse(params.access);
    const identity = thumbnailSpriteIdentitySchema.parse(params.identity);
    await resolveThumbnailSource(params.authority, access, identity, signal);
    const cancelled = await params.jobs.cancel({ access, identity, idempotencyKey: thumbnailJobIdempotencyKey(access, identity) }, signal);
    requireThumbnailActive(signal);
    if (typeof cancelled !== "boolean") rejectThumbnail("THUMBNAIL_JOB_ACK_INVALID");
    return { cancelled };
  });
}

/** Handles exactly one already-claimed production job. Timers renew that lease, never schedule jobs. */
export async function processClaimedThumbnailJob(params: {
  claim: unknown; authority: ThumbnailAuthority; runtime: ContainedThumbnailRuntime;
  jobs: ThumbnailProductionJobsPort; signal: AbortSignal; now?: () => number; heartbeatIntervalMs?: number;
}) {
  const claim = thumbnailClaimSchema.parse(params.claim);
  const intervalMs = params.heartbeatIntervalMs ?? 5_000;
  if (!Number.isInteger(intervalMs) || intervalMs < 10 || intervalMs > 30_000) rejectThumbnail("THUMBNAIL_HEARTBEAT_INVALID");
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  params.signal.addEventListener("abort", onAbort, { once: true });
  if (params.signal.aborted) controller.abort();
  let leaseState: LeaseState = "RUNNING";
  let renewing = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const heartbeat = async () => {
    if (renewing || controller.signal.aborted) return;
    renewing = true;
    try {
      const state = await withThumbnailDeadline(controller.signal,
        (signal) => params.jobs.heartbeat(claim, signal), 5_000);
      if (state !== "RUNNING") {
        leaseState = state === "CANCELLED" ? "CANCELLED" : "LEASE_LOST";
        controller.abort();
      }
    } catch {
      // An uncertain renewal provides no authority; preserve durable status for reconciliation.
      if (leaseState === "RUNNING" && !params.signal.aborted) leaseState = "LEASE_LOST";
      controller.abort();
    } finally { renewing = false; }
  };
  try {
    requireThumbnailActive(controller.signal);
    await heartbeat();
    requireThumbnailActive(controller.signal);
    timer = setInterval(() => { void heartbeat(); }, intervalMs);
    const result = await produceThumbnailSprite({ access: claim.access, identity: claim.identity,
      authority: params.authority, runtime: params.runtime, store: params.jobs.storeForClaim(claim),
      signal: controller.signal, now: params.now });
    requireThumbnailActive(controller.signal);
    // Completion ACK uncertainty is distinct from execution failure; never overwrite or auto-retry it.
    let acknowledged: boolean;
    try {
      acknowledged = await withThumbnailDeadline(controller.signal,
        (signal) => params.jobs.complete(claim, result.manifest, signal));
      if (typeof acknowledged !== "boolean") rejectThumbnail("THUMBNAIL_JOB_ACK_INVALID");
    } catch {
      return { status: "UNCONFIRMED" as const, jobId: claim.jobId };
    }
    return { status: acknowledged ? "SUCCEEDED" as const : "LEASE_LOST" as const,
      jobId: claim.jobId, cacheHit: result.cacheHit };
  } catch (error) {
    if (leaseState !== "RUNNING") return { status: leaseState, jobId: claim.jobId };
    if (params.signal.aborted) return { status: "INTERRUPTED" as const, jobId: claim.jobId };
    const code = error instanceof ThumbnailDerivativeError && /^THUMBNAIL_[A-Z_]+$/.test(error.code)
      ? error.code : "THUMBNAIL_EXECUTION_FAILED";
    try {
      const acknowledged = await withThumbnailDeadline(controller.signal,
        (signal) => params.jobs.fail(claim, code, signal));
      if (typeof acknowledged !== "boolean") rejectThumbnail("THUMBNAIL_JOB_ACK_INVALID");
      return { status: acknowledged ? "FAILED" as const : "LEASE_LOST" as const, jobId: claim.jobId, code };
    } catch { return { status: "UNCONFIRMED" as const, jobId: claim.jobId, code }; }
  } finally {
    if (timer) clearInterval(timer);
    controller.abort();
    params.signal.removeEventListener("abort", onAbort);
  }
}

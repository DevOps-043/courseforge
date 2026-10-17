import { z } from "zod";
import { THUMBNAIL_POLICY, thumbnailSpriteManifestSchema, type ThumbnailSpriteIdentity } from "./thumbnail-derivative.contract";

/** Local admission budgets, proposed for integration; not measured OS quotas. */
export const THUMBNAIL_RUNTIME_LIMITS = {
  maxSourceBytes: 256 * 1024 * 1024,
  maxSourcePixels: 33_177_600,
  operationTimeoutMs: 120_000,
  maxCacheLifetimeMs: 24 * 60 * 60 * 1_000,
} as const;

export class ThumbnailDerivativeError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ThumbnailDerivativeError"; }
}
export function rejectThumbnail(code: string): never { throw new ThumbnailDerivativeError(code); }
export function requireThumbnailActive(signal: AbortSignal) {
  if (signal.aborted) rejectThumbnail("THUMBNAIL_CANCELLED");
}

/** Must be constructed from authenticated server context, never trusted from request body. */
export const thumbnailAccessSchema = z.object({
  actorId: z.string().uuid(), organizationId: z.string().uuid(),
  componentId: z.string().uuid(), sourceAssetId: z.string().uuid(),
}).strict();
export type ThumbnailAccess = z.infer<typeof thumbnailAccessSchema>;

const sizeSchema = z.number().int().positive().max(16_384);
export const thumbnailAuthorizedSourceSchema = thumbnailAccessSchema.extend({
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceDurationMs: z.number().int().positive().max(THUMBNAIL_POLICY.maxSourceDurationMs),
  byteLength: z.number().int().positive().max(THUMBNAIL_RUNTIME_LIMITS.maxSourceBytes),
  mimeType: z.enum(["video/mp4", "video/webm", "video/quicktime"]),
  width: sizeSchema, height: sizeSchema,
}).strict().refine((source) => source.width * source.height <= THUMBNAIL_RUNTIME_LIMITS.maxSourcePixels);
export type ThumbnailAuthorizedSource = z.infer<typeof thumbnailAuthorizedSourceSchema>;
export type ThumbnailManifest = z.infer<typeof thumbnailSpriteManifestSchema>;

export interface ThumbnailAuthority {
  /** Checks current actor membership, component ownership, asset link/status and immutable source metadata. */
  resolve(access: ThumbnailAccess, signal: AbortSignal): Promise<unknown>;
  /** Opens exactly the resolved source; caller cannot supply a URL/path. Must cancel the transport on abort. */
  open(source: ThumbnailAuthorizedSource, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>>;
}

export interface ThumbnailSpriteInspection {
  mimeType: "image/webp"; width: number; height: number; frameCount: 1;
}
export interface ThumbnailSpriteInspector {
  /** Full decode, inside operator-owned containment, not a header-only assertion. */
  inspectSprite(bytes: Uint8Array, signal: AbortSignal): Promise<ThumbnailSpriteInspection>;
}

/** Trusted host injection. No default executor, shell invocation, network URL or client capability flag. */
export interface ContainedThumbnailRuntime extends ThumbnailSpriteInspector {
  probeSource(bytes: Uint8Array, signal: AbortSignal): Promise<{
    mimeType: ThumbnailAuthorizedSource["mimeType"]; durationMs: number; width: number; height: number;
  }>;
  generateSprite(request: {
    sourceBytes: Uint8Array; source: ThumbnailAuthorizedSource; identity: ThumbnailSpriteIdentity;
    timestampsMs: readonly number[]; tileWidth: 160; tileHeight: 90; columns: 8;
    width: number; height: number; maxOutputBytes: number; signal: AbortSignal;
  }): Promise<{ bytes: AsyncIterable<Uint8Array>; sourceTimestampsMs: number[] }>;
}

export const thumbnailCacheRecordSchema = z.object({
  manifest: thumbnailSpriteManifestSchema,
  objectKey: z.string().min(1).max(512),
  expiresAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type ThumbnailCacheRecord = z.infer<typeof thumbnailCacheRecordSchema>;

/** Binding to private Storage/index belongs to core integration, not a new cache/job engine. */
export interface ThumbnailStore {
  lookup(identity: ThumbnailSpriteIdentity, signal: AbortSignal): Promise<unknown | null>;
  open(record: ThumbnailCacheRecord, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>>;
  /** Immutable blob + fenced CAS of its index, including expiry renewal for identical bytes.
   * Duplicate publication must not overwrite blob bytes or grant access. Lost ACK requires readback.
   */
  putCreateOnly(record: ThumbnailCacheRecord, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
}

/** Bounds awaiting a port, even if it ignores cancellation. Does not prove OS process termination. */
export async function withThumbnailDeadline<T>(
  parent: AbortSignal, operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = THUMBNAIL_RUNTIME_LIMITS.operationTimeoutMs,
): Promise<T> {
  requireThumbnailActive(parent);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(new ThumbnailDerivativeError("THUMBNAIL_CANCELLED"));
    };
    parent.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new ThumbnailDerivativeError("THUMBNAIL_TIMEOUT"));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([Promise.resolve().then(() => {
      requireThumbnailActive(controller.signal);
      return operation(controller.signal);
    }), interrupted]);
    requireThumbnailActive(parent);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    parent.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

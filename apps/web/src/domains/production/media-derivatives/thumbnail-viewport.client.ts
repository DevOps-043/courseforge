import { thumbnailSpriteCacheKey, thumbnailSpriteManifestSchema, type ThumbnailSpriteIdentity } from "./thumbnail-derivative.contract";
import { planThumbnailSprites, type ThumbnailPlanInput } from "./thumbnail-plan.service";
import { rejectThumbnail, requireThumbnailActive, withThumbnailDeadline, type ThumbnailManifest } from "./thumbnail-runtime.contract";

export const THUMBNAIL_VIEWPORT_LIMITS = {
  maxConcurrentReads: 2, maxPages: 9, maxCompressedBytes: 72 * 1024 * 1024,
  maxDecodedBytes: 36 * 1024 * 1024, timeoutMs: 30_000,
} as const;
export type ThumbnailPlan = ReturnType<typeof planThumbnailSprites>;
/** Must call authorized server delivery for every load; no persistent grant or cache-key-only endpoint. */
export type ThumbnailLoader = (identity: ThumbnailSpriteIdentity, signal: AbortSignal) => Promise<{
  manifest: unknown; bytes: Uint8Array;
} | null>;
export interface ThumbnailViewportResources {
  create(bytes: Uint8Array): string;
  revoke(url: string): void;
  sha256(bytes: Uint8Array): Promise<string>;
}
export interface ThumbnailViewport {
  plan: ThumbnailPlan; pages: Map<string, { manifest: ThumbnailManifest; url: string }>;
  missing: ThumbnailSpriteIdentity[]; dispose(): void;
}

export const browserThumbnailResources: ThumbnailViewportResources = {
  create: (bytes) => URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: "image/webp" })),
  revoke: (url) => URL.revokeObjectURL(url),
  sha256: async (bytes) => {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  },
};

/** Read-only viewport allocation, in planner priority order. No job engine, source decode or proxy selection. */
export async function loadThumbnailViewport(params: {
  input: ThumbnailPlanInput; load: ThumbnailLoader; signal: AbortSignal; resources?: ThumbnailViewportResources;
}): Promise<ThumbnailViewport> {
  const plan = planThumbnailSprites(params.input);
  if (plan.pages.length > THUMBNAIL_VIEWPORT_LIMITS.maxPages) rejectThumbnail("THUMBNAIL_VIEWPORT_PAGE_LIMIT");
  const resources = params.resources ?? browserThumbnailResources;
  const pages: ThumbnailViewport["pages"] = new Map();
  const missing: ThumbnailSpriteIdentity[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const page of pages.values()) resources.revoke(page.url);
    pages.clear();
  };
  try {
    return await withThumbnailDeadline(params.signal, async (signal) => {
      let cursor = 0;
      let byteLength = 0;
      let decodedBytes = 0;
      const worker = async () => {
        while (cursor < plan.pages.length) {
          requireThumbnailActive(signal);
          const page = plan.pages[cursor++];
          const result = await params.load(page.identity, signal);
          requireThumbnailActive(signal);
          if (disposed) rejectThumbnail("THUMBNAIL_CANCELLED");
          if (!result) { missing.push(page.identity); continue; }
          const parsed = thumbnailSpriteManifestSchema.safeParse(result.manifest);
          if (!parsed.success || !(result.bytes instanceof Uint8Array)) rejectThumbnail("THUMBNAIL_MANIFEST_INVALID");
          const manifest = parsed.data;
          if (thumbnailSpriteCacheKey(manifest.identity) !== page.cacheKey) rejectThumbnail("THUMBNAIL_IDENTITY_MISMATCH");
          if (result.bytes.length !== manifest.byteLength) rejectThumbnail("THUMBNAIL_INTEGRITY_MISMATCH");
          byteLength += result.bytes.length;
          decodedBytes += manifest.width * manifest.height * 4;
          if (byteLength > THUMBNAIL_VIEWPORT_LIMITS.maxCompressedBytes || decodedBytes > THUMBNAIL_VIEWPORT_LIMITS.maxDecodedBytes) rejectThumbnail("THUMBNAIL_VIEWPORT_MEMORY_LIMIT");
          if (await resources.sha256(result.bytes) !== manifest.spriteSha256) rejectThumbnail("THUMBNAIL_INTEGRITY_MISMATCH");
          requireThumbnailActive(signal);
          if (disposed) rejectThumbnail("THUMBNAIL_CANCELLED");
          pages.set(page.cacheKey, { manifest, url: resources.create(result.bytes) });
        }
      };
      await Promise.all(Array.from({ length: Math.min(THUMBNAIL_VIEWPORT_LIMITS.maxConcurrentReads, plan.pages.length) }, worker));
      requireThumbnailActive(signal);
      return { plan, pages, missing, dispose };
    }, THUMBNAIL_VIEWPORT_LIMITS.timeoutMs);
  } catch (error) { dispose(); throw error; }
}

/** Shared delivery policy for browser-previewable production media. */
export const PRODUCTION_MEDIA_CACHE_CONTROL_SECONDS = 60 * 60;

/** Buckets intentionally created as public by migration and safe to address deterministically. */
export const PUBLIC_PRODUCTION_MEDIA_BUCKETS = new Set(["production-assets", "production-videos"]);

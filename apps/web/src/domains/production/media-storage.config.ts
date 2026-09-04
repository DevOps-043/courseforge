/** Shared delivery policy for browser-previewable production media. */
export const PRODUCTION_MEDIA_CACHE_CONTROL_SECONDS = 60 * 60;

/** Private source objects are signed only when a renderer needs to fetch them. */
export const HYPERFRAMES_PRIVATE_SOURCE_BUCKET = "production-render-sources";

/** Long enough for a queued render to fetch its inputs; never persisted in a snapshot. */
export const HYPERFRAMES_SOURCE_SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;

/** Buckets intentionally created as public by migration and safe to address deterministically. */
export const PUBLIC_PRODUCTION_MEDIA_BUCKETS = new Set(["production-assets", "production-videos"]);

/** Storage identities accepted by the server-side HyperFrames delivery adapter. */
export const HYPERFRAMES_SOURCE_BUCKETS = new Set([
  "production-assets",
  HYPERFRAMES_PRIVATE_SOURCE_BUCKET,
  "sound-effect-assets",
]);

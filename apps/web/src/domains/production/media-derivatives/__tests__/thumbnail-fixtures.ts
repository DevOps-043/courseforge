import { thumbnailSpriteManifestSchema, type ThumbnailSpriteIdentity } from "../thumbnail-derivative.contract";
import { planThumbnailSprites, type ThumbnailPlanInput } from "../thumbnail-plan.service";
import { type ContainedThumbnailRuntime, type ThumbnailAuthority, type ThumbnailCacheRecord, type ThumbnailStore,
  requireThumbnailActive, rejectThumbnail } from "../thumbnail-runtime.contract";
import { thumbnailObjectKey, thumbnailPageRecipe, thumbnailSha256 } from "../thumbnail-verifier.server";

export const tenant = "11111111-1111-4111-8111-111111111111";
export const otherTenant = "22222222-2222-4222-8222-222222222222";
export const access = { actorId: "33333333-3333-4333-8333-333333333333", organizationId: tenant,
  componentId: "44444444-4444-4444-8444-444444444444", sourceAssetId: "55555555-5555-4555-8555-555555555555" };
export const sourceBytes = Buffer.from("source-contract-fixture; no media decoding or sandbox evidence");
export const input: ThumbnailPlanInput = { source: { organizationId: tenant, sourceSha256: thumbnailSha256(sourceBytes), sourceDurationMs: 120_000 },
  interval: { sourceOffsetMs: 10_000, durationMs: 2_001 },
  viewport: { startMs: 0, endMs: 2_001, pixelsPerSecond: 640 }, playheadMs: 1_000 };
export const identity = planThumbnailSprites(input).pages[0].identity;
export const signal = () => new AbortController().signal;
export async function* stream(bytes: Uint8Array) { yield bytes; }

/** A synthetic RIFF/VP8L header, NOT a valid compressed image or proof of full decode/isolation. */
export function headerFixture(width: number, height: number) {
  const bytes = Buffer.alloc(26);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(18, 4); bytes.write("WEBP", 8);
  bytes.write("VP8L", 12); bytes.writeUInt32LE(5, 16); bytes[20] = 0x2f;
  bytes.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  return bytes;
}

export function spriteFixture(id: ThumbnailSpriteIdentity = identity) {
  const recipe = thumbnailPageRecipe(id);
  const bytes = headerFixture(recipe.width, recipe.height);
  const manifest = thumbnailSpriteManifestSchema.parse({ identity: id, spriteSha256: thumbnailSha256(bytes),
    mimeType: "image/webp", byteLength: bytes.length, width: recipe.width, height: recipe.height,
    sourceTimestampsMs: recipe.timestampsMs });
  return { manifest, bytes };
}

export function harness() {
  const calls = { resolved: 0, opened: 0, generated: 0, probed: 0, inspected: 0, written: 0, cacheRead: 0 };
  let source = { ...access, ...input.source, byteLength: sourceBytes.length,
    mimeType: "video/mp4" as const, width: 1920, height: 1080 };
  const records = new Map<string, { record: ThumbnailCacheRecord; bytes: Uint8Array }>();
  const authority: ThumbnailAuthority = {
    resolve: async () => { calls.resolved++; return { ...source }; },
    open: async () => { calls.opened++; return stream(sourceBytes); },
  };
  const runtime: ContainedThumbnailRuntime = {
    probeSource: async () => { calls.probed++; return { mimeType: source.mimeType, durationMs: source.sourceDurationMs, width: source.width, height: source.height }; },
    generateSprite: async (request) => {
      calls.generated++;
      return { bytes: stream(spriteFixture(request.identity).bytes), sourceTimestampsMs: [...request.timestampsMs] };
    },
    inspectSprite: async () => { calls.inspected++; return { mimeType: "image/webp", frameCount: 1,
      width: 1280, height: 180 }; },
  };
  const store: ThumbnailStore = {
    lookup: async (id) => {
      calls.cacheRead++;
      // Fixtures deliberately use the actual identity digest rather than permissions from a key.
      const fixture = spriteFixture(id);
      const row = records.get(thumbnailObjectKey(fixture.manifest));
      return row ? structuredClone(row.record) : null;
    },
    open: async (record) => stream(records.get(record.objectKey)!.bytes),
    putCreateOnly: async (record, bytes, active) => {
      requireThumbnailActive(active);
      const previous = records.get(record.objectKey);
      if (previous) {
        if (thumbnailSha256(previous.bytes) !== record.manifest.spriteSha256) rejectThumbnail("THUMBNAIL_PUBLICATION_CONFLICT");
        // Models index renewal only. Storage blob remains byte-for-byte immutable.
        previous.record = structuredClone(record);
        return;
      }
      calls.written++;
      records.set(record.objectKey, { record: structuredClone(record), bytes: Uint8Array.from(bytes) });
    },
  };
  return { authority, runtime, store, calls, records, source: () => source,
    changeSource: (changed: Partial<typeof source>) => { source = { ...source, ...changed }; } };
}

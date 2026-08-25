import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HYPERFRAMES_ASSET_DELIVERY_MODES,
  HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES,
} from "../hyperframes.types";
import { validateHyperframesPreflight } from "../hyperframes-preflight.service";
import {
  buildHyperframesAssetVariableName,
  resolveHyperframesAssetVariables,
} from "../hyperframes-asset-delivery.service";

const asset = (overrides: Record<string, unknown> = {}) => ({
  checksum: "a".repeat(64),
  fileSizeBytes: 10 * 1024 * 1024,
  mimeType: "video/mp4",
  productionAssetId: "11111111-1111-4111-8111-111111111111",
  storagePath: "organizations/org/assets/video.mp4",
  ...overrides,
});

describe("HyperFrames render preflight", () => {
  it("resolves stable content-versioned variables from trusted Storage identity", async () => {
    const supabase = {
      storage: {
        from: (bucket: string) => ({
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://project.supabase.co/${bucket}/${path}` } }),
        }),
      },
    };
    const productionAssetId = "11111111-1111-4111-8111-111111111111";
    const variables = await resolveHyperframesAssetVariables({
      assets: [asset({ fileSizeBytes: 250 * 1024 * 1024, storageBucket: "production-assets" })],
      supabase: supabase as never,
    });

    assert.deepEqual(variables, {
      [buildHyperframesAssetVariableName(productionAssetId)]: `https://project.supabase.co/production-assets/organizations/org/assets/video.mp4?v=${"a".repeat(64)}`,
    });
  });

  it("rejects untrusted buckets before provider submission", async () => {
    const supabase = { storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "https://example.test" } }) }) } };
    await assert.rejects(() => resolveHyperframesAssetVariables({
      assets: [asset({ storageBucket: "private-course-assets" })],
      supabase: supabase as never,
    }), /no permite entrega remota/);
  });

  it("signs private render sources just in time", async () => {
    const supabase = {
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: { signedUrl: "https://project.supabase.co/storage/private/video.mp4?token=temporary" },
            error: null,
          }),
        }),
      },
    };
    const variables = await resolveHyperframesAssetVariables({
      assets: [asset({ storageBucket: "production-render-sources" })],
      supabase: supabase as never,
    });

    assert.match(Object.values(variables)[0]!, /token=temporary/);
  });

  it("counts a repeated checksum once against the cloud limit", () => {
    const result = validateHyperframesPreflight({
      assets: [asset(), asset({ productionAssetId: "22222222-2222-4222-8222-222222222222" })],
    });

    assert.equal(result.valid, true);
    assert.equal(result.totalAssetBytes, 10 * 1024 * 1024);
    assert.equal(result.duplicateAssetCount, 1);
  });

  it("blocks unique assets larger than 200 MiB", () => {
    const result = validateHyperframesPreflight({
      assets: [
        asset({ checksum: "b".repeat(64), fileSizeBytes: 150 * 1024 * 1024 }),
        asset({
          checksum: "c".repeat(64),
          fileSizeBytes: 60 * 1024 * 1024,
          productionAssetId: "22222222-2222-4222-8222-222222222222",
        }),
      ],
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("assets únicos")));
  });

  it("blocks an oversized archive even when the asset manifest is valid", () => {
    const result = validateHyperframesPreflight({
      archiveSizeBytes: HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES + 1,
      assets: [asset()],
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("empaquetado")));
  });

  it("blocks an individual video larger than the 100 MiB provider limit", () => {
    const result = validateHyperframesPreflight({
      assets: [asset({ fileSizeBytes: 101 * 1024 * 1024 })],
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("100 MiB")));
  });

  it("allows large aggregate media when the thin project uses remote variables", () => {
    const result = validateHyperframesPreflight({
      assets: [
        asset({ checksum: "b".repeat(64), fileSizeBytes: 250 * 1024 * 1024 }),
        asset({
          checksum: "c".repeat(64),
          fileSizeBytes: 250 * 1024 * 1024,
          productionAssetId: "22222222-2222-4222-8222-222222222222",
        }),
      ],
      deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
    });

    assert.equal(result.valid, true);
    assert.equal(result.totalAssetBytes, 500 * 1024 * 1024);
    assert.equal(result.deliveryMode, HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES);
  });

  it("blocks MOV inputs before consuming a provider render attempt", () => {
    const result = validateHyperframesPreflight({
      assets: [asset({ mimeType: "video/quicktime", storagePath: "assets/avatar.mov" })],
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("MP4 o WebM")));
  });

  it("rejects unsafe asset paths before a render can be submitted", () => {
    const result = validateHyperframesPreflight({
      assets: [asset({ storagePath: "../secreto.mp4" })],
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("ruta de storage")));
  });

  it("warns when a long standard render should be segmented", () => {
    const result = validateHyperframesPreflight({
      assets: [asset()],
      deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
      durationSeconds: 30 * 60,
      renderProfile: { format: "mp4", fps: 25, quality: "standard", resolution: "1080p" },
    });

    assert.equal(result.valid, true);
    assert.ok(result.renderBudget);
    assert.ok(result.renderBudget.recommendedSegmentCount >= 3);
    assert.ok(result.warnings.some((warning) => warning.includes("segmentos")));
  });

  it("blocks a predicted output larger than the durable 2 GiB limit", () => {
    const result = validateHyperframesPreflight({
      assets: [asset()],
      deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
      durationSeconds: 30 * 60,
      renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" },
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("2 GiB")));
  });
});

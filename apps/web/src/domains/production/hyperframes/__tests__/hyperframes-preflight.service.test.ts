import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES,
} from "../hyperframes.types";
import { validateHyperframesPreflight } from "../hyperframes-preflight.service";

const asset = (overrides: Record<string, unknown> = {}) => ({
  checksum: "a".repeat(64),
  fileSizeBytes: 10 * 1024 * 1024,
  mimeType: "video/mp4",
  productionAssetId: "11111111-1111-4111-8111-111111111111",
  storagePath: "organizations/org/assets/video.mp4",
  ...overrides,
});

describe("HyperFrames render preflight", () => {
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

  it("rejects unsafe asset paths before a render can be submitted", () => {
    const result = validateHyperframesPreflight({
      assets: [asset({ storagePath: "../secreto.mp4" })],
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("ruta de storage")));
  });
});

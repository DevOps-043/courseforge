import assert from "node:assert/strict";
import test from "node:test";
import { assertHtmlEditingImageIdentities } from "../composition-html-editing-image-identity";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function fixture() {
  const current = { productionAssetId: uuid, checksum: "a".repeat(64), fileSizeBytes: 1024,
    mimeType: "image/png", storageBucket: "production-assets", storagePath: "html/image.png" };
  const frozen = { assetId: uuid, checksum: current.checksum, fileSizeBytes: current.fileSizeBytes,
    mimeType: current.mimeType, storageBucket: current.storageBucket, storagePath: current.storagePath,
    localPath: `conformance-media/${uuid}` };
  return { current, frozen };
}

test("current image identity must match every frozen field, not only the authorized UUID", () => {
  const { current, frozen } = fixture();
  assert.doesNotThrow(() => assertHtmlEditingImageIdentities({ usedAssetIds: [uuid], currentImages: [current], frozenBindings: [frozen] }));
  for (const field of ["checksum", "fileSizeBytes", "mimeType", "storageBucket", "storagePath"] as const) {
    const changed = { ...current, [field]: field === "fileSizeBytes" ? 2048 : field === "checksum" ? "b".repeat(64)
      : field === "mimeType" ? "image/webp" : field === "storageBucket" ? "production-videos" : "html/replaced.png" };
    assert.throws(() => assertHtmlEditingImageIdentities({ usedAssetIds: [uuid], currentImages: [changed], frozenBindings: [frozen] }),
      /IMAGE_IDENTITY_(MISMATCH|INVALID)/);
  }
});

test("only actually used images require a frozen binding; unused authorized options do not change historical content", () => {
  const { current, frozen } = fixture();
  assert.doesNotThrow(() => assertHtmlEditingImageIdentities({ usedAssetIds: [uuid], frozenBindings: [frozen],
    currentImages: [current, { ...current, productionAssetId: other, checksum: "b".repeat(64) }] }));
  assert.doesNotThrow(() => assertHtmlEditingImageIdentities({ usedAssetIds: [], frozenBindings: [], currentImages: [] }));
});

test("missing current record, missing frozen binding and altered local alias cannot authorize bytes", () => {
  const { current, frozen } = fixture();
  for (const input of [ { currentImages: [], frozenBindings: [frozen] },
    { currentImages: [current], frozenBindings: [] },
    { currentImages: [current], frozenBindings: [{...frozen, localPath: `conformance-media/${other}`}] } ]) {
    assert.throws(() => assertHtmlEditingImageIdentities({ usedAssetIds: [uuid], ...input }), /IMAGE_IDENTITY_MISMATCH/);
  }
});

test("identity inputs reject duplicates, unknown fields, unsafe paths, active formats and image budget violations", () => {
  const { current, frozen } = fixture();
  for (const currentImages of [undefined, [current, current], [{ ...current, secret: "untrusted" }],
    [{ ...current, storagePath: "../escape" }], [{ ...current, storageBucket: "private-secrets" }],
    [{ ...current, mimeType: "image/svg+xml" }], [{ ...current, fileSizeBytes: 32 * 1024 * 1024 + 1 }]]) {
    assert.throws(() => assertHtmlEditingImageIdentities({ usedAssetIds: [uuid], currentImages, frozenBindings: [frozen] }), /IMAGE_IDENTITY_INVALID/);
  }
  assert.throws(() => assertHtmlEditingImageIdentities({ usedAssetIds: [uuid, uuid], currentImages: [current], frozenBindings: [frozen] }), /IMAGE_IDENTITY_INVALID/);
  assert.throws(() => assertHtmlEditingImageIdentities({ usedAssetIds: [uuid], currentImages: [current], frozenBindings: [frozen, frozen] }), /IMAGE_IDENTITY_INVALID/);
});

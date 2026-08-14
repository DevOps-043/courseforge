import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectInternalMaterialAssetReferences,
  extractHyperframesAnimatedDeck,
  inspectHyperframesSourceAsset,
  isSupportedHyperframesSourceMime,
} from "../hyperframes-source-asset.service";

describe("HyperFrames source assets", () => {
  it("only exposes renderable media from the internal asset registry", () => {
    assert.equal(isSupportedHyperframesSourceMime("video/mp4"), true);
    assert.equal(isSupportedHyperframesSourceMime("audio/mpeg"), true);
    assert.equal(isSupportedHyperframesSourceMime("text/html"), false);
    assert.equal(isSupportedHyperframesSourceMime("application/zip"), false);
  });

  it("keeps a ready animated deck as HTML rather than slide images", () => {
    const deck = extractHyperframesAnimatedDeck({
      slides: {
        animated_deck: {
          css: ".slide { opacity: calc(var(--deck-t) + .1); }",
          fonts: [],
          height: 1080,
          slides: [{ animationCount: 2, classes: "slide active", html: "<h1>Uno</h1>", index: 1, label: "Introducción" }],
          status: "READY_FOR_PREVIEW",
          width: 1920,
        },
        images: [{ storage_path: "production-assets/slides/rasterized.png" }],
      },
    });

    assert.equal(deck?.slides[0]?.html, "<h1>Uno</h1>");
    assert.equal(deck?.slides[0]?.animationCount, 2);
  });

  it("marks rasterized slides as deck dependencies when the HTML deck is ready", () => {
    const references = collectInternalMaterialAssetReferences({
      slides: {
        animated_deck: {
          css: ".slide { color: white; }",
          fonts: [],
          height: 1080,
          slides: [{ animationCount: 0, classes: "slide active", html: "<h1>Uno</h1>", index: 1, label: "Uno" }],
          status: "READY_FOR_PREVIEW",
          width: 1920,
        },
        images: [{ storage_path: "production-assets/slides/rasterized.png" }],
      },
    });

    assert.equal(references[0]?.sourceType, "DECK_DEPENDENCY");
  });

  it("identifies images embedded by the deck separately from uploaded production media", () => {
    const references = collectInternalMaterialAssetReferences({
      avatar_video: { storage_path: "production-assets/avatars/avatar.mp4" },
      slides: {
        animated_deck: {
          remote_assets: [{
            content_type: "image/png",
            storage_path: "production-assets/slides/deck/assets/chart.png",
          }],
        },
      },
    });

    assert.deepEqual(references.map((reference) => reference.sourceType), [
      "PRODUCTION_MEDIA",
      "DECK_DEPENDENCY",
    ]);
  });

  it("inherits only internally stored media from the Production step", () => {
    const assets = collectInternalMaterialAssetReferences({
      avatar_video: {
        file_name: "avatar.mp4",
        public_url: "https://example.test/avatar.mp4",
        storage_path: "production-assets/avatars/component-avatar.mp4",
      },
      b_roll_clips: [{
        file_name: "external.mp4",
        public_url: "https://example.test/external.mp4",
        storage_path: "https://example.test/external.mp4",
      }],
      slides: {
        images: [{
          content_type: "image/png",
          file_name: "slide-01.png",
          public_url: "https://example.test/slide-01.png",
          storage_path: "production-assets/slides/component-slide-01.png",
        }],
      },
    });

    assert.deepEqual(assets.map((asset) => asset.storagePath), [
      "production-assets/avatars/component-avatar.mp4",
      "production-assets/slides/component-slide-01.png",
    ]);
  });

  it("keeps an authored avatar duration so the assembly template can use it", () => {
    const references = collectInternalMaterialAssetReferences({
      avatar_video: {
        duration: 160,
        storage_path: "production-assets/avatars/component-avatar.mp4",
      },
    });

    assert.equal(references[0]?.durationSeconds, 160);
    assert.equal(references[0]?.timelineRole, "AVATAR");
  });

  it("keeps an oversized file visible with a clear preflight warning", () => {
    const asset = inspectHyperframesSourceAsset({
      checksum: "a".repeat(64),
      fileSizeBytes: 201 * 1024 * 1024,
      metadata: { file_name: "avatar-largo.mp4" },
      mimeType: "video/mp4",
      productionAssetId: "550e8400-e29b-41d4-a716-446655440000",
      sourceType: "PRODUCTION_MEDIA",
      storagePath: "avatars/avatar-largo.mp4",
    });

    assert.equal(asset?.eligibleForRevision, false);
    assert.match(asset?.validationErrors.join(" ") || "", /avatar-largo\.mp4/);
    assert.match(asset?.validationErrors.join(" ") || "", /200 MB/);
  });
});

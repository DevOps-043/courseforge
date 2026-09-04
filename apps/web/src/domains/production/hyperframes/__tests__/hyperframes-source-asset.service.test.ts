import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectInternalMaterialAssetReferences,
  extractHyperframesAnimatedDeck,
  inspectHyperframesSourceAsset,
  isAutomaticTimelineSourceAsset,
  isHyperframesSourceDurationCurrent,
  isHyperframesSourceMetadataCurrent,
  isRecoverableManualVoiceRegistryAsset,
  isSupportedHyperframesSourceMime,
  shouldExposeProductionRegistryAsset,
} from "../hyperframes-source-asset.service";

describe("HyperFrames source assets", () => {
  it("only exposes renderable media from the internal asset registry", () => {
    assert.equal(isSupportedHyperframesSourceMime("video/mp4"), true);
    assert.equal(isSupportedHyperframesSourceMime("audio/mpeg"), true);
    assert.equal(isSupportedHyperframesSourceMime("text/html"), false);
    assert.equal(isSupportedHyperframesSourceMime("application/zip"), false);
  });

  it("recovers manual cloud voices persisted before multi-audio references existed", () => {
    assert.equal(isRecoverableManualVoiceRegistryAsset({
      assetType: "SOURCE_MEDIA",
      metadata: { import_type: "voice", source_provider: "google_drive" },
    }), true);
    assert.equal(isRecoverableManualVoiceRegistryAsset({
      assetType: "SOURCE_MEDIA",
      metadata: { import_type: "music" },
    }), false);
  });

  it("keeps recovered avatar and voice history visible without reviving archived media", () => {
    assert.equal(shouldExposeProductionRegistryAsset({
      assetType: "AVATAR_VIDEO_CLIP",
      hasActiveReference: false,
      qaStatus: "READY_FOR_QA",
    }), true);
    assert.equal(shouldExposeProductionRegistryAsset({
      assetType: "AVATAR_VIDEO_CLIP",
      hasActiveReference: false,
      qaStatus: "ARCHIVED",
    }), false);
    assert.equal(shouldExposeProductionRegistryAsset({
      assetType: "VOICE_AUDIO",
      hasActiveReference: false,
      qaStatus: "READY_FOR_QA",
    }), true);
    assert.equal(shouldExposeProductionRegistryAsset({
      assetType: "VOICE_AUDIO",
      hasActiveReference: false,
      qaStatus: "ARCHIVED",
    }), false);
    assert.equal(isAutomaticTimelineSourceAsset({
      metadata: { historical_only: true },
      sourceType: "PRODUCTION_MEDIA",
    }), false);
    assert.equal(isAutomaticTimelineSourceAsset({
      metadata: {},
      sourceType: "PRODUCTION_MEDIA",
    }), true);
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
    assert.equal(deck?.appearance, "light");
  });

  it("inherits appearance and repairs CSS from ready legacy decks", () => {
    const deck = extractHyperframesAnimatedDeck({
      slides: {
        appearance: "dark",
        animated_deck: {
          css: '.deck-scope :root[data-appearance="dark"] { --bg: #0F1419; }',
          fonts: [],
          height: 1080,
          slides: [{ animationCount: 0, classes: "slide active", html: "<h1>Legado</h1>", index: 1, label: "Legado" }],
          status: "READY_FOR_RENDER",
          width: 1920,
        },
      },
    });

    assert.equal(deck?.appearance, "dark");
    assert.match(deck?.css || "", /\.deck-scope\[data-appearance="dark"\]/);
    assert.doesNotMatch(deck?.css || "", /\.deck-scope\s+:root/);
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

  it("keeps uploaded b-roll dimensions for deterministic source-aspect layout", () => {
    const references = collectInternalMaterialAssetReferences({
      b_roll_clips: [{
        height: 1920,
        storage_path: "production-assets/broll/vertical.mp4",
        width: 1080,
      }],
    });

    assert.equal(references[0]?.sourceHeight, 1920);
    assert.equal(references[0]?.sourceWidth, 1080);
  });

  it("fails closed for historical B-roll audio and preserves avatar narration", () => {
    const references = collectInternalMaterialAssetReferences({
      avatar_video: {
        storage_path: "production-assets/avatars/avatar.mp4",
      },
      b_roll_clips: [{
        storage_path: "production-assets/broll/silent.mp4",
      }, {
        has_audio: true,
        storage_path: "production-assets/broll/authored-audio.mp4",
      }],
    });

    assert.equal(references.find((asset) => asset.timelineRole === "AVATAR")?.hasAudio, true);
    assert.equal(references.find((asset) => asset.storagePath.endsWith("silent.mp4"))?.hasAudio, false);
    assert.equal(references.find((asset) => asset.storagePath.endsWith("authored-audio.mp4"))?.hasAudio, true);
  });

  it("preserves scene identity for interleaved avatar and voice assets", () => {
    const references = collectInternalMaterialAssetReferences({
      avatar_clips: [{
        asset_name: "Lección 6 · Apertura",
        id: "scene-1",
        order: 1,
        status: "COMPLETED",
        storage_path: "production-assets/heygen/avatar-1.mp4",
      }, {
        id: "scene-2",
        order: 2,
        status: "DRAFT",
      }],
      avatar_generation_mode: "scene_clips",
      voice_clips: [{
        clip_id: "scene-1",
        order: 1,
        status: "COMPLETED",
        storage_path: "production-assets/heygen/voice-1.mp3",
      }, {
        clip_id: "scene-2",
        order: 2,
        status: "COMPLETED",
        storage_path: "production-assets/heygen/voice-2.mp3",
      }],
    });

    assert.deepEqual(references.map((reference) => ({
      clipId: reference.sceneClipId,
      displayName: reference.displayName,
      order: reference.sceneOrder,
      role: reference.timelineRole,
    })), [
      { clipId: "scene-1", displayName: "Lección 6 · Apertura", order: 1, role: "VOICE" },
      { clipId: "scene-2", displayName: undefined, order: 2, role: "VOICE" },
      { clipId: "scene-1", displayName: "Lección 6 · Apertura", order: 1, role: "AVATAR" },
    ]);
  });

  it("compares synchronized durations at the persisted millisecond precision", () => {
    assert.equal(isHyperframesSourceDurationCurrent(13_455, 13, 13.4546), true);
    assert.equal(isHyperframesSourceDurationCurrent(13_455, 13, 13.456), false);
    assert.equal(isHyperframesSourceDurationCurrent(null, 13, undefined), true);
  });

  it("detects stale scene identity when an active source becomes standalone", () => {
    const standaloneReference = collectInternalMaterialAssetReferences({
      voice_audio: {
        file_name: "voice.mp3",
        storage_path: "production-assets/voices/voice.mp3",
      },
    })[0]!;
    const staleMetadata = {
      assembly_source_type: "PRODUCTION_MEDIA",
      file_name: "voice.mp3",
      scene_clip_id: "legacy-scene",
      scene_order: 4,
      source_provider: "production_step",
      timeline_role: "VOICE",
      timeline_variant: "CLIP",
    };

    assert.equal(isHyperframesSourceMetadataCurrent(
      staleMetadata,
      standaloneReference,
      "voice.mp3",
    ), false);
    assert.equal(isHyperframesSourceMetadataCurrent(
      {
        assembly_source_type: "PRODUCTION_MEDIA",
        file_name: "voice.mp3",
        source_provider: "production_step",
        timeline_role: "VOICE",
      },
      standaloneReference,
      "voice.mp3",
    ), true);
  });

  it("registers editor-detached audio as an editable narration source", () => {
    const references = collectInternalMaterialAssetReferences({
      detached_audio_clips: [{
        content_type: "audio/wav",
        duration: 12.5,
        file_name: "clip-audio.wav",
        has_audio: true,
        storage_path: "production-assets/editor-audio/component/clip-audio.wav",
      }],
    });

    assert.equal(references[0]?.durationSeconds, 12.5);
    assert.equal(references[0]?.mimeType, "audio/wav");
    assert.equal(references[0]?.timelineRole, "VOICE");
  });

  it("exposes every manually uploaded voice as an independent timeline asset", () => {
    const references = collectInternalMaterialAssetReferences({
      manual_voice_clips: [{
        duration: 12,
        file_name: "voice-1.mp3",
        id: "manual-voice-1",
        order: 1,
        storage_path: "production-assets/voices/voice-1.mp3",
      }, {
        duration: 18,
        file_name: "voice-2.mp3",
        id: "manual-voice-2",
        order: 2,
        storage_path: "production-assets/voices/voice-2.mp3",
      }],
    });

    assert.equal(references.length, 2);
    assert.deepEqual(references.map((asset) => asset.timelineRole), ["VOICE", "VOICE"]);
    assert.deepEqual(references.map((asset) => asset.durationSeconds), [12, 18]);
    assert.deepEqual(references.map((asset) => asset.fileName), ["voice-1.mp3", "voice-2.mp3"]);
  });

  it("accepts a video above the embedded limit when Storage delivers it remotely", () => {
    const asset = inspectHyperframesSourceAsset({
      checksum: "a".repeat(64),
      fileSizeBytes: 101 * 1024 * 1024,
      metadata: { file_name: "avatar-largo.mp4" },
      mimeType: "video/mp4",
      productionAssetId: "550e8400-e29b-41d4-a716-446655440000",
      sourceType: "PRODUCTION_MEDIA",
      storagePath: "avatars/avatar-largo.mp4",
    });

    assert.equal(asset?.eligibleForRevision, true);
    assert.deepEqual(asset?.validationErrors, []);
  });

  it("keeps a video above the remote Storage limit visible with a warning", () => {
    const asset = inspectHyperframesSourceAsset({
      checksum: "a".repeat(64),
      fileSizeBytes: (2 * 1024 * 1024 * 1024) + 1,
      metadata: { file_name: "avatar-fuera-de-limite.mp4" },
      mimeType: "video/mp4",
      productionAssetId: "550e8400-e29b-41d4-a716-446655440000",
      sourceType: "PRODUCTION_MEDIA",
      storagePath: "avatars/avatar-fuera-de-limite.mp4",
    });

    assert.equal(asset?.eligibleForRevision, false);
    assert.match(asset?.validationErrors.join(" ") || "", /avatar-fuera-de-limite\.mp4/);
  });

  it("blocks source media above the maximum supported resolution", () => {
    const asset = inspectHyperframesSourceAsset({
      checksum: "b".repeat(64),
      fileSizeBytes: 20 * 1024 * 1024,
      metadata: { file_name: "avatar-4k.mp4", source_height: 3840, source_width: 2160 },
      mimeType: "video/mp4",
      productionAssetId: "550e8400-e29b-41d4-a716-446655440000",
      sourceType: "PRODUCTION_MEDIA",
      storagePath: "avatars/avatar-4k.mp4",
    });

    assert.equal(asset?.eligibleForRevision, false);
    assert.match(asset?.validationErrors.join(" ") || "", /2160×3840/);
    assert.match(asset?.validationErrors.join(" ") || "", /1920 px/);
  });
});

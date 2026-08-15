import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { createInitialCompositionDocument } from "../composition-document.factory";
import {
  COMPOSITION_COMPILATION_TARGETS,
  compileCompositionPreview,
} from "../composition-preview-compiler.service";
import {
  COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS,
  resolveCompositionPreviewAssetUrls,
} from "../composition-preview-assets.service";

test("uses one-hour scoped signatures so a preview can renew media without iframe authentication", () => {
  assert.equal(COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS, 60 * 60);
});

test("embeds a freshly signed Storage URL instead of an authenticated iframe asset route", async () => {
  const assetId = "00000000-0000-4000-8000-000000000041";
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "4".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: assetId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/broll.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Preview" },
  });
  const query = (data: unknown) => {
    const builder = {
      eq: () => builder,
      in: () => builder,
      select: () => builder,
      then: (resolve: (value: unknown) => unknown) => resolve({ data, error: null }),
    };
    return builder;
  };
  const supabase = {
    from: (table: string) => table === "video_composition_draft_assets"
      ? query([{ production_asset_id: assetId }])
      : query([{ id: assetId, storage_bucket: "production-assets", storage_path: "production-assets/broll.mp4" }]),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, ttl: number) => {
          assert.equal(path, "broll.mp4");
          assert.equal(ttl, COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS);
          return { data: { signedUrl: "https://storage.test/signed-broll.mp4?token=scoped" }, error: null };
        },
      }),
    },
  };

  const urls = await resolveCompositionPreviewAssetUrls({
    document,
    draftId: "f7d8853b-49cb-4a46-acd9-2c21696686c3",
    organizationId: "550e8400-e29b-41d4-a716-446655440000",
    supabase: supabase as never,
  });

  assert.equal(urls.get(assetId), "https://storage.test/signed-broll.mp4?token=scoped");
});

test("compiles the native document into a seekable preview with stable visual ids", async () => {
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: ".slide { color: white; }", fonts: [], height: 1080, width: 1920,
      slides: [{ animationCount: 1, classes: "slide", html: '<h1>Uno</h1><img src="https://cdn.test/deck.png" />', index: 0, label: "Uno" }],
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Deck" },
  });
  const html = await compileCompositionPreview({
    assetUrls: new Map(),
    deckAssetUrls: new Map([["https://cdn.test/deck.png", "assets/deck.png"]]),
    document,
  });

  assert.match(html, /data-composition-id="courseforge-composition"/);
  assert.match(html, /id="composition-viewport" data-composition-id="courseforge-composition"/);
  assert.match(html, /id="deck-slide-0-timeline" class="clip"/);
  assert.match(html, /data-hf-id="deck-slide-0"/);
  assert.match(html, /window\.__timelines\["courseforge-composition"\]/);
  assert.match(html, /courseforge-composition-selection/);
  assert.match(html, /courseforge-composition-editor-settings/);
  assert.match(html, /composition-editor-grid/);
  assert.match(html, /snapEnabled/);
  assert.match(html, /composition-viewport/);
  assert.match(html, /fitCompositionToViewport/);
  assert.match(html, /class="deck-scope"/);
  assert.match(html, /class="deck-shell"/);
  assert.match(html, /class="deck-stage"/);
  assert.match(html, /<section class="slide">/);
  assert.match(html, /<h1>Uno<\/h1>/);
  assert.match(html, /src="assets\/deck\.png"/);
  assert.doesNotMatch(html, /https:\/\/cdn\.test\/deck\.png/);
  assert.match(html, /"--deck-t": 0/);
  assert.match(html, /"--deck-t": clip\.duration/);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new Script(match[1]));
  }
});

test("fails closed when a document references an asset without a preview URL", async () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "a".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000004", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/video.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Video" },
  });
  await assert.rejects(() => compileCompositionPreview({ assetUrls: new Map(), document }));
});

test("compiles a deterministic HyperFrames render document without the interactive controller", async () => {
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: ".slide { color: white; }", fonts: [], height: 1080, width: 1920,
      slides: [{ animationCount: 1, classes: "slide", html: "<h1>Uno</h1>", index: 0, label: "Uno" }],
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 5, subtitle: "Prueba", title: "Render" },
  });
  const html = await compileCompositionPreview({
    assetUrls: new Map(),
    document,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
  });

  assert.match(html, /window\.__timelines\["courseforge-composition"\]/);
  assert.match(html, /gsap\.timeline\(\{ paused: true \}\)/);
  assert.doesNotMatch(html, /requestAnimationFrame|performance\.now|courseforge-composition-media-error/);
  assert.doesNotMatch(html, /GSAP 3\./);
  assert.match(html, /<script src="assets\/gsap\.min\.js"><\/script>/);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new Script(match[1]));
  }
});

test("creates a separate synchronized audio element for an avatar video", async () => {
  const avatarId = "00000000-0000-4000-8000-000000000005";
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "b".repeat(64), durationSeconds: 30, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: avatarId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/avatar.mp4", timelineRole: "AVATAR" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Avatar" },
  });
  document.tracks.find((track) => track.id === "avatar")!.volume = 0.35;
  const html = await compileCompositionPreview({ assetUrls: new Map([[avatarId, "https://example.test/avatar.mp4"]]), document });
  assert.match(html, /asset-00000000-0000-4000-8000-000000000005-audio/);
  assert.match(html, /courseforge-composition-media-error/);
  assert.match(html, /composition-audio-unlock/);
  assert.match(html, /media\.play\(\)/);
  assert.match(html, /pendingMediaPlayback\.has\(media\)/);
  assert.match(html, /error\?\.name === "AbortError"/);
  assert.match(html, /id="asset-00000000-0000-4000-8000-000000000005-media"/);
  assert.doesNotMatch(html, /media\.getAttribute\("src"\)/);
  assert.match(html, /data-volume="0\.35"/);

  const renderHtml = await compileCompositionPreview({
    assetUrls: new Map([[avatarId, "assets/avatar.mp4"]]),
    document,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
  });
  assert.match(renderHtml, /id="asset-00000000-0000-4000-8000-000000000005-media" class="composition-media clip"/);
  assert.match(renderHtml, /data-media-start="0"/);
  assert.match(renderHtml, /id="asset-00000000-0000-4000-8000-000000000005-audio" class="composition-audio clip"/);
  assert.doesNotMatch(renderHtml, /media\.play\(\)|composition-audio-unlock/);
});

test("compiles the same seek-safe music ducking envelope for preview and render", async () => {
  const musicId = "00000000-0000-4000-8000-000000000006";
  const voiceId = "00000000-0000-4000-8000-000000000007";
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [
      { checksum: "c".repeat(64), durationSeconds: 10, fileSizeBytes: 4, mimeType: "audio/mpeg", productionAssetId: musicId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/music.mp3", timelineRole: "AUDIO" },
      { checksum: "d".repeat(64), durationSeconds: 2, fileSizeBytes: 4, mimeType: "audio/mpeg", productionAssetId: voiceId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/voice.mp3", timelineRole: "VOICE" },
    ],
    plan: { accentColor: "#38BDF8", durationSeconds: 10, subtitle: "Prueba", title: "Audio" },
  });
  document.canvas.durationSeconds = 10;
  const musicClip = document.clips.find((clip) => clip.trackId === "music")!;
  musicClip.durationSeconds = 10;
  const voiceClip = document.clips.find((clip) => clip.trackId === "voice")!;
  voiceClip.startSeconds = 3;
  const assetUrls = new Map([[musicId, "assets/music.mp3"], [voiceId, "assets/voice.mp3"]]);

  const previewHtml = await compileCompositionPreview({ assetUrls, document });
  const renderHtml = await compileCompositionPreview({
    assetUrls,
    document,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
  });

  for (const html of [previewHtml, renderHtml]) {
    assert.match(html, /data-volume-automated="true"/);
    assert.match(html, /"timeSeconds":3,"volume":0\.0875/);
    assert.match(html, /timeline\.fromTo\(/);
  }
  assert.match(previewHtml, /media\.dataset\.volumeAutomated !== "true"/);
});

test("compiles motion on an inner subject without replacing the editable layout", async () => {
  const document = createInitialCompositionDocument({
    animatedDeck: { css: "", fonts: [], height: 1080, width: 1920, slides: [{ animationCount: 0, classes: "slide", html: "<h1>Motion</h1>", index: 0, label: "Motion" }] },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 5, subtitle: "Prueba", title: "Motion" },
  });
  const clip = document.clips[0]!;
  document.motion.animations.push({
    id: "motion-fade-in-preview",
    keyframes: [{ offset: 0, values: { opacity: 0 } }, { ease: "power2.out", offset: 1, values: { opacity: 1 } }],
    origin: "PRESET",
    preset: { id: "FADE_IN", version: 1 },
    propertyGroup: "OPACITY",
    target: { clipId: clip.id, part: "CONTENT" },
    timing: { anchor: "CLIP_START", durationSeconds: 0.7, offsetSeconds: 0 },
  });
  const html = await compileCompositionPreview({ assetUrls: new Map(), document });
  assert.match(html, new RegExp(`id="${clip.id}" data-hf-id="${clip.hfId}"`));
  assert.match(html, new RegExp(`id="${clip.id}-motion" class="motion-subject deck-content"`));
  assert.match(html, /const motionAnimations =/);
  assert.match(html, /timeline\.set\(target, first\.values, animation\.start\)/);
  assert.match(html, /timeline\.to\(target/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { createInitialCompositionDocument } from "../composition-document.factory";
import {
  COMPOSITION_COMPILATION_TARGETS,
  COMPOSITION_PREVIEW_MEDIA_CONFIG,
  compileCompositionPreview,
} from "../composition-preview-compiler.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import {
  COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS,
  COMPOSITION_PREVIEW_PUBLIC_BUCKETS,
  COMPOSITION_PREVIEW_SIGNING_CONCURRENCY,
  resolveCompositionPreviewAssetUrls,
} from "../composition-preview-assets.service";

test("uses stable public URLs and scoped signatures without iframe authentication", () => {
  assert.equal(COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS, 60 * 60);
  assert.equal(COMPOSITION_PREVIEW_SIGNING_CONCURRENCY, 6);
  assert.deepEqual([...COMPOSITION_PREVIEW_PUBLIC_BUCKETS], ["production-assets", "production-videos"]);
});

test("keeps preview media warming bounded for remote assets", () => {
  assert.deepEqual(COMPOSITION_PREVIEW_MEDIA_CONFIG, {
    bufferingTimeoutMs: 12_000,
    forcedSeekToleranceSeconds: 0.05,
    lookaheadSeconds: 15,
    maxPrimedMedia: 6,
    minimumReadyState: 2,
    seekToleranceSeconds: 0.35,
  });
});

test("embeds a stable Storage URL for public production media", async () => {
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
      : query([{ checksum: "4".repeat(64), id: assetId, storage_bucket: "production-assets", storage_path: "production-assets/broll.mp4" }]),
    storage: {
      from: () => ({
        createSignedUrl: async () => { throw new Error("A public preview asset must not be signed"); },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/public/${path}` } }),
      }),
    },
  };

  const urls = await resolveCompositionPreviewAssetUrls({
    document,
    draftId: "f7d8853b-49cb-4a46-acd9-2c21696686c3",
    organizationId: "550e8400-e29b-41d4-a716-446655440000",
    supabase: supabase as never,
  });

  assert.equal(urls.get(assetId), `https://storage.test/public/broll.mp4?v=${"4".repeat(64)}`);
});

test("signs preview assets in bounded parallel batches", async () => {
  const assetIds = Array.from({ length: 7 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "7".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: assetIds[0], publicUrl: null, storageBucket: "private-media", storagePath: "private-media/video-0.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 56, subtitle: "Prueba", title: "Firmas" },
  });
  const sourceClip = document.clips.find((clip) => clip.source.type === "PRODUCTION_ASSET")!;
  document.clips = assetIds.map((productionAssetId, index) => ({
    ...sourceClip,
    hfId: `bounded-signing-${index}`,
    id: `bounded-signing-${index}`,
    source: { productionAssetId, type: "PRODUCTION_ASSET" as const },
    startSeconds: index * 8,
  }));
  const query = (data: unknown) => {
    const builder = {
      eq: () => builder,
      in: () => builder,
      select: () => builder,
      then: (resolve: (value: unknown) => unknown) => resolve({ data, error: null }),
    };
    return builder;
  };
  let activeSignatures = 0;
  let maximumActiveSignatures = 0;
  const supabase = {
    from: (table: string) => table === "video_composition_draft_assets"
      ? query(assetIds.map((productionAssetId) => ({ production_asset_id: productionAssetId })))
      : query(assetIds.map((id, index) => ({ id, storage_bucket: "private-media", storage_path: `private-media/video-${index}.mp4` }))),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          activeSignatures += 1;
          maximumActiveSignatures = Math.max(maximumActiveSignatures, activeSignatures);
          await new Promise<void>((resolve) => setImmediate(resolve));
          activeSignatures -= 1;
          return { data: { signedUrl: `https://storage.test/${path}?token=scoped` }, error: null };
        },
        getPublicUrl: () => { throw new Error("A private preview asset must not use a public URL"); },
      }),
    },
  };

  const urls = await resolveCompositionPreviewAssetUrls({
    document,
    draftId: "f7d8853b-49cb-4a46-acd9-2c21696686c3",
    organizationId: "550e8400-e29b-41d4-a716-446655440000",
    supabase: supabase as never,
  });

  assert.equal(urls.size, assetIds.length);
  assert.equal(maximumActiveSignatures, COMPOSITION_PREVIEW_SIGNING_CONCURRENCY);
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
  assert.match(html, /background-size: 16px 16px/);
  assert.match(html, /composition-move-handle/);
  assert.match(html, /Mover elemento/);
  assert.match(html, /courseforge-composition-preview-zoom/);
  assert.match(html, /--preview-user-scale/);
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

test("applies an HTML slide crop identically in preview and HyperFrames render", async () => {
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: ".slide h1 { opacity: calc(var(--deck-t) / 2); }",
      fonts: [],
      height: 1080,
      slides: [{ animationCount: 1, classes: "slide", html: "<h1>Recortable</h1>", index: 0, label: "Recortable" }],
      width: 1920,
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 5, subtitle: "Prueba", title: "Deck recortable" },
  });
  const slide = document.clips.find((clip) => clip.kind === "DECK_SLIDE")!;
  const cropped = applyCompositionEditorPatches(document, [{
    clipId: slide.id,
    crop: { top: 40, right: 80, bottom: 120, left: 160 },
    type: "clip.crop",
  }]);
  const previewHtml = await compileCompositionPreview({ assetUrls: new Map(), document: cropped });
  const renderHtml = await compileCompositionPreview({
    assetUrls: new Map(),
    document: cropped,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
  });

  for (const html of [previewHtml, renderHtml]) {
    assert.match(html, /data-croppable="true"/);
    assert.match(html, /class="motion-subject deck-content" style="clip-path:inset\(40px 80px 120px 160px\);"/);
    assert.match(html, /"--deck-t": clip\.duration/);
  }
  assert.match(previewHtml, /target\.dataset\.croppable === "true"/);
});

test("fails closed when a document references an asset without a preview URL", async () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "a".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000004", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/video.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Video" },
  });
  await assert.rejects(() => compileCompositionPreview({ assetUrls: new Map(), document }));
});

test("compiles the same spatial crop into preview and HyperFrames render", async () => {
  const assetId = "00000000-0000-4000-8000-000000000044";
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "c".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: assetId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/avatar.mp4", timelineRole: "AVATAR" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Crop" },
  });
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const cropped = applyCompositionEditorPatches(document, [{ clipId: video.id, crop: { top: 12, right: 24, bottom: 36, left: 48 }, type: "clip.crop" }]);
  const assetUrls = new Map([[assetId, "assets/avatar.mp4"]]);
  const previewHtml = await compileCompositionPreview({ assetUrls, document: cropped });
  const renderHtml = await compileCompositionPreview({ assetUrls, document: cropped, target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER });
  const cropStyle = "clip-path:inset(12px 24px 36px 48px);";

  assert.match(previewHtml, new RegExp(cropStyle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(renderHtml, new RegExp(cropStyle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(previewHtml, /courseforge-composition-crop-commit/);
  assert.match(previewHtml, /courseforge-composition-preview-crop/);
  assert.match(previewHtml, /moveCropWindow/);
  assert.doesNotMatch(previewHtml, /addEventListener\("wheel"/);
  assert.match(previewHtml, /composition-crop-handle/);
  assert.match(previewHtml, /mode: cropHandle \? "crop-edge"/);
  assert.match(previewHtml, /adjustCropFromHandle/);
  assert.match(previewHtml, /transform\.mode === "crop-move" \|\| transform\.mode === "crop-edge"/);
  assert.match(previewHtml, /\.clip-content \{[^}]*pointer-events: none/);
  assert.match(previewHtml, /\.motion-subject \{[^}]*pointer-events: auto/);
  assert.match(previewHtml, /inset: var\(--crop-top, 0px\) var\(--crop-right, 0px\) var\(--crop-bottom, 0px\) var\(--crop-left, 0px\)/);
  assert.match(previewHtml, /const minX = -activeTransform\.crop\.left/);
  assert.match(previewHtml, /const maxX = canvasWidth - activeTransform\.layout\.width \+ activeTransform\.crop\.right/);
  assert.match(previewHtml, /scaleCropForLayout\(activeTransform\.crop, activeTransform\.layout/);
  assert.doesNotMatch(previewHtml, /resizeCropFrame/);
  assert.doesNotMatch(renderHtml, /courseforge-composition-crop-commit/);
});

test("scales crop insets with layout size instead of narrowing the visible window", () => {
  const assetId = "00000000-0000-4000-8000-000000000045";
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "d".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: assetId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/avatar.mp4", timelineRole: "AVATAR" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Crop resize" },
  });
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const cropped = applyCompositionEditorPatches(document, [{
    clipId: video.id,
    crop: { top: 12, right: 24, bottom: 36, left: 48 },
    type: "clip.crop",
  }]);
  const croppedVideo = cropped.clips.find((clip) => clip.id === video.id)!;
  const resized = applyCompositionEditorPatches(cropped, [{
    clipId: video.id,
    layout: { height: croppedVideo.layout.height / 2, width: croppedVideo.layout.width / 2 },
    type: "clip.layout",
  }]);
  const resizedVideo = resized.clips.find((clip) => clip.id === video.id)!;

  assert.deepEqual(resizedVideo.crop, { top: 6, right: 12, bottom: 18, left: 24 });
});

test("keeps vertical B-roll fully visible with identical preview and render fit", async () => {
  const assetId = "00000000-0000-4000-8000-000000000046";
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "e".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4",
      productionAssetId: assetId, publicUrl: null, sourceHeight: 1920, sourceWidth: 1080,
      storageBucket: "production-assets", storagePath: "production-assets/vertical.mp4", timelineRole: "BROLL",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Vertical" },
  });
  const assetUrls = new Map([[assetId, "assets/vertical.mp4"]]);
  const previewHtml = await compileCompositionPreview({ assetUrls, document });
  const renderHtml = await compileCompositionPreview({ assetUrls, document, target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER });

  for (const html of [previewHtml, renderHtml]) {
    assert.match(html, /data-media-fit="CONTAIN"/);
    assert.match(html, /data-preserve-aspect="CENTER"/);
    assert.match(html, /left:656px;top:0px;width:608px;height:1080px/);
  }
  assert.match(previewHtml, /querySelectorAll\('\.clip-content\[data-preserve-aspect\] video'\)/);

  const legacyDocument = structuredClone(document);
  delete legacyDocument.clips[0]!.mediaFit;
  const legacyHtml = await compileCompositionPreview({ assetUrls, document: legacyDocument });
  assert.match(legacyHtml, /data-media-fit="COVER"/);
  assert.doesNotMatch(legacyHtml, /data-preserve-aspect="CENTER"/);
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
  assert.match(html, /data-preserve-aspect="BOTTOM_RIGHT"/);
  assert.match(html, /data-media-fit="CONTAIN"\] \.composition-media \{ object-fit: contain; \}/);
  assert.match(html, /courseforge-composition-aspect-corrections/);
  assert.match(html, /media\.videoWidth \|\| media\.naturalWidth/);
  assert.match(html, /usesLegacyAvatarBox/);
  assert.match(html, /playsinline loop preload="metadata"/);
  assert.match(html, /media\.loop \? sourceTime % media\.duration/);
  assert.match(html, /--editor-control-scale/);
  assert.match(html, /transform-origin: bottom right/);
  assert.match(html, /Arrastra para cambiar el tamaño/);
  assert.match(html, /asset-00000000-0000-4000-8000-000000000005-audio/);
  assert.match(html, /courseforge-composition-media-error/);
  assert.match(html, /composition-audio-unlock/);
  assert.match(html, /media\.play\(\)/);
  assert.match(html, /pendingMediaPlayback\.has\(media\)/);
  assert.match(html, /error\?\.name === "AbortError"/);
  assert.match(html, /const blockedAudioMedia = new Set\(\)/);
  assert.match(html, /error\?\.name !== "NotAllowedError" \|\| media\.tagName !== "AUDIO"/);
  assert.match(html, /blockedAudioMedia\.add\(media\)/);
  assert.match(html, /blockedAudioMedia\.has\(media\)/);
  assert.match(html, /blockedAudioMedia\.clear\(\);[\s\S]*syncMedia\(currentTime, true\)/);
  assert.doesNotMatch(html, /error\?\.name === "NotAllowedError"\) \{[\s\S]*playbackActive = false/);
  assert.match(html, /preload="metadata"/);
  assert.match(html, /const active = mediaIsActiveAt\(media, time\)/);
  assert.match(html, /const MEDIA_LOOKAHEAD_SECONDS = 15/);
  assert.match(html, /const MAX_PRIMED_MEDIA = 6/);
  assert.match(html, /media\.readyState >= MEDIA_MINIMUM_READY_STATE/);
  assert.match(html, /if \(media\.preload !== "auto"\) media\.preload = "auto"/);
  assert.match(html, /primedMedia\.add\(media\);[\s\S]*media\.load\(\)/);
  assert.match(html, /seekPrimedMediaToEntryPoint\(media, time\)/);
  assert.match(html, /sourceOffset \+ timelineTarget - start/);
  assert.match(html, /media\.currentTime = sourceTime/);
  assert.match(html, /courseforge-composition-media-state/);
  assert.match(html, /courseforge-composition-media-metric/);
  assert.match(html, /preview_initial_ready_ms/);
  assert.match(html, /media_warmup_ms/);
  assert.match(html, /buffering_duration_ms/);
  assert.match(html, /requestVideoFrameCallback/);
  assert.match(html, /postMediaState\("PREPARING", pending\)/);
  assert.match(html, /postMediaState\("BUFFERING", pending\)/);
  assert.match(html, /if \(enterBuffering\(next, pending\)\) return/);
  assert.match(html, /\["waiting", "stalled"\]/);
  assert.match(html, /MEDIA_BUFFERING_TIMEOUT_MS/);
  assert.match(html, /El medio no entregó un frame reproducible dentro del tiempo permitido/);
  assert.match(html, /announceInitialReadyIfPossible\(\)/);
  assert.match(html, /const seekTolerance = forceSeek \|\| entered/);
  assert.match(html, /Math\.abs\(media\.currentTime - next\) > seekTolerance/);
  assert.doesNotMatch(html, /forceSeek \|\| entered \|\| Math\.abs/);
  assert.match(html, /const scrubTo = \(time\) => \{[\s\S]*pause\(\);[\s\S]*seek\(time, true\)/);
  assert.match(html, /courseforge-composition-seek"\) scrubTo\(message\.seconds\)/);
  assert.match(html, /mediaParticipatesInPlayback/);
  assert.match(html, /Number\(media\.dataset\.volume \|\| 0\) > 0/);
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

test("applies independent B-roll clip volume in preview and render", async () => {
  const brollId = "00000000-0000-4000-8000-000000000006";
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "c".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: brollId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/broll.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "B-roll" },
  });
  const broll = document.clips.find((clip) => clip.trackId === "broll")!;
  const edited = applyCompositionEditorPatches(document, [{ clipId: broll.id, type: "clip.volume", volume: 0.4 }]);

  const previewHtml = await compileCompositionPreview({
    assetUrls: new Map([[brollId, "https://example.test/broll.mp4"]]),
    document: edited,
  });
  assert.match(previewHtml, new RegExp(`id="${broll.id}-audio"`));
  assert.match(previewHtml, new RegExp(`id="${broll.id}-audio"[^>]+data-volume="0\\.4"`));
  assert.match(previewHtml, new RegExp(`id="${broll.id}-media"[^>]+muted`));

  const renderHtml = await compileCompositionPreview({
    assetUrls: new Map([[brollId, "assets/broll.mp4"]]),
    document: edited,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
  });
  assert.match(renderHtml, new RegExp(`id="${broll.id}-audio" class="composition-audio clip"[^>]+data-volume="0\\.4"`));

  delete broll.volume;
  const legacyHtml = await compileCompositionPreview({
    assetUrls: new Map([[brollId, "https://example.test/broll.mp4"]]),
    document,
  });
  assert.match(legacyHtml, new RegExp(`id="${broll.id}-audio"[^>]+data-volume="0"`));
});

test("compiles derived video clips with the same source and their distinct media offsets", async () => {
  const avatarId = "00000000-0000-4000-8000-000000000015";
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "e".repeat(64), durationSeconds: 30, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: avatarId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/avatar.mp4", timelineRole: "AVATAR" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 30, subtitle: "Prueba", title: "Cortes" },
  });
  const avatar = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const split = applyCompositionEditorPatches(document, [{
    atSeconds: 12,
    clipId: avatar.id,
    newClipId: "avatar-second-cut",
    newHfId: "avatar-second-cut-hf",
    type: "clip.split",
  }]);

  const html = await compileCompositionPreview({
    assetUrls: new Map([[avatarId, "assets/avatar.mp4"]]),
    document: split,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
  });

  assert.equal((html.match(/src="assets\/avatar\.mp4"/g) || []).length, 4);
  assert.match(html, /id="avatar-second-cut-media"[\s\S]*data-media-start="12"/);
  assert.match(html, /id="avatar-second-cut-audio"[\s\S]*data-media-start="12"/);
});

test("mantiene preview y render en paridad para dividir a 01:30 y eliminar un intervalo intermedio", async () => {
  const avatarId = "00000000-0000-4000-8000-000000000016";
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "f".repeat(64), durationSeconds: 180, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: avatarId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/avatar.mp4", timelineRole: "AVATAR" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 180, subtitle: "Prueba", title: "Edición no destructiva" },
  });
  document.canvas.durationSeconds = 180;
  const avatar = document.clips.find((clip) => clip.kind === "VIDEO")!;
  avatar.durationSeconds = 180;
  avatar.sourceDurationSeconds = 180;

  const split = applyCompositionEditorPatches(document, [{
    atSeconds: 90,
    clipId: avatar.id,
    newClipId: "avatar-after-0130",
    newHfId: "avatar-after-0130-hf",
    type: "clip.split",
  }]);
  const afterSplit = split.clips.find((clip) => clip.id === "avatar-after-0130")!;
  const edited = applyCompositionEditorPatches(split, [{
    clipId: afterSplit.id,
    endSeconds: 110,
    newClipId: "avatar-after-gap",
    newHfId: "avatar-after-gap-hf",
    ripple: true,
    startSeconds: 100,
    type: "clip.remove-range",
  }]);
  const assetUrls = new Map([[avatarId, "assets/avatar.mp4"]]);
  const previewHtml = await compileCompositionPreview({ assetUrls, document: edited });
  const renderHtml = await compileCompositionPreview({
    assetUrls,
    document: edited,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
  });

  const sourceWindows = edited.clips
    .filter((clip) => clip.kind === "VIDEO")
    .map((clip) => [clip.sourceOffsetSeconds || 0, clip.durationSeconds, clip.startSeconds]);
  assert.deepEqual(sourceWindows, [[0, 90, 0], [90, 10, 90], [110, 70, 100]]);
  assert.equal((renderHtml.match(/src="assets\/avatar\.mp4"/g) || []).length, 6);
  for (const html of [previewHtml, renderHtml]) {
    assert.match(html, /data-source-offset="90"/);
    assert.match(html, /data-source-offset="110"/);
  }
  assert.match(renderHtml, /id="avatar-after-0130-media"[\s\S]*data-media-start="90"/);
  assert.match(renderHtml, /id="avatar-after-gap-media"[\s\S]*data-media-start="110"/);
  assert.match(renderHtml, /id="avatar-after-gap-audio"[\s\S]*data-media-start="110"/);
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
  const animated = applyCompositionEditorPatches(document, [{
    animationId: "motion-pulse-preview",
    clipId: clip.id,
    durationSeconds: 3,
    presetId: "PULSE",
    type: "animation.add-preset",
  }]);
  const html = await compileCompositionPreview({ assetUrls: new Map(), document: animated });
  assert.match(html, new RegExp(`id="${clip.id}" data-hf-id="${clip.hfId}"`));
  assert.match(html, new RegExp(`id="${clip.id}-motion" class="motion-subject deck-content"`));
  assert.match(html, /const motionAnimations =/);
  assert.match(html, /motion-pulse-preview/);
  assert.match(html, /timeline\.set\(target, first\.values, animation\.start\)/);
  assert.match(html, /timeline\.to\(target/);
  const motionPayload = html.match(/const motionAnimations = (\[[^;]+\]);/)?.[1];
  assert.ok(motionPayload);
  assert.doesNotMatch(motionPayload, /repeat/);
});

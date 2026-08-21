import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMissingProductionAssetClips,
  createInitialCompositionDocument,
  reconcileCompositionDocument,
} from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import {
  CompositionDurationResolutionError,
  resolveCompositionDuration,
} from "../composition-duration.service";
import { normalizeCompositionTrackTopology } from "../composition-track-registry";
import { formatCompositionTimecode, parseCompositionTimecode } from "../composition-timecode";

test("preserves deck HTML as editable clips and labels missing timings as estimated", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: ".slide { color: white; }",
      fonts: [],
      height: 1080,
      slides: [
        { animationCount: 1, classes: "slide", html: "<h1>Uno</h1>", index: 0, label: "Uno" },
        { animationCount: 2, classes: "slide", html: "<h1>Dos</h1>", index: 1, label: "Dos" },
      ],
      width: 1920,
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Deck" },
  });

  assert.equal(document.canvas.durationSeconds, 10);
  assert.equal(document.clips[0]?.source.type, "DECK_SLIDE");
  assert.equal(document.clips[0]?.timingSource, "ESTIMATED");
  assert.equal(document.clips[0]?.layout.zIndex, 1);
  assert.match(document.clips[0]?.source.html || "", /<h1>Uno<\/h1>/);
  assert.equal(document.clips[1]?.startSeconds, 5);
});

test("formats and parses editor timecodes without decimal ambiguity", () => {
  assert.equal(formatCompositionTimecode(1.05), "00:01.050");
  assert.equal(formatCompositionTimecode(65), "01:05");
  assert.equal(formatCompositionTimecode(3661.25), "01:01:01.250");
  assert.equal(parseCompositionTimecode("01:05"), 65);
  assert.equal(parseCompositionTimecode("2:40"), 160);
  assert.equal(parseCompositionTimecode("00:01.050"), 1.05);
  assert.equal(parseCompositionTimecode("1,5"), 1.5);
  assert.equal(parseCompositionTimecode("00:65"), null);
});

test("keeps production media as references instead of copying files", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "a".repeat(64),
      durationSeconds: 8,
      fileSizeBytes: 40,
      mimeType: "video/mp4",
      productionAssetId: "00000000-0000-4000-8000-000000000001",
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: "production-assets/demo.mp4",
      timelineRole: "BROLL",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Video" },
  });

  assert.equal(document.clips[0]?.source.type, "PRODUCTION_ASSET");
  assert.equal(document.clips[0]?.source.productionAssetId, "00000000-0000-4000-8000-000000000001");
  assert.equal(document.clips[0]?.volume, 0);
  assert.equal(document.clips[0]?.mediaFit, "CONTAIN");
});

test("centers a vertical b-roll at source aspect without hiding its frame", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "9".repeat(64), durationSeconds: 8, fileSizeBytes: 40, mimeType: "video/mp4",
      productionAssetId: "00000000-0000-4000-8000-000000000099", publicUrl: null,
      sourceHeight: 1920, sourceWidth: 1080, storageBucket: "production-assets",
      storagePath: "production-assets/vertical.mp4", timelineRole: "BROLL",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Vertical" },
  });
  const clip = document.clips[0]!;

  assert.equal(clip.mediaFit, "CONTAIN");
  assert.deepEqual(clip.layout, { height: 1080, opacity: 1, rotation: 0, width: 608, x: 656, y: 0, zIndex: 2 });
  assert.deepEqual(clip.source, {
    productionAssetId: "00000000-0000-4000-8000-000000000099",
    sourceHeight: 1920,
    sourceWidth: 1080,
    type: "PRODUCTION_ASSET",
  });
});

test("separates voice and music into semantic layers the agent can identify", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [
      { checksum: "1".repeat(64), durationSeconds: 10, fileSizeBytes: 4, mimeType: "audio/mpeg", productionAssetId: "00000000-0000-4000-8000-000000000031", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/voice.mp3", timelineRole: "VOICE" },
      { checksum: "2".repeat(64), durationSeconds: 30, fileSizeBytes: 4, mimeType: "audio/mpeg", productionAssetId: "00000000-0000-4000-8000-000000000032", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/music.mp3", timelineRole: "AUDIO" },
    ],
    plan: { accentColor: "#38BDF8", durationSeconds: 10, subtitle: "Prueba", title: "Audio" },
  });

  assert.equal(document.clips.find((clip) => clip.label.includes("Asset 1"))?.trackId, "voice");
  assert.equal(document.clips.find((clip) => clip.label.includes("Asset 2"))?.trackId, "music");
  assert.equal(document.tracks.find((track) => track.id === "voice")?.semanticRole, "VOICE");
  assert.equal(document.tracks.find((track) => track.id === "music")?.semanticRole, "MUSIC");
});

test("preserves persisted layer controls while normalizing the track topology", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: { css: ".slide { color: white; }", fonts: [], height: 1080, slides: [{ animationCount: 0, classes: "slide active", html: "<h1>Audio</h1>", index: 0, label: "Audio" }], width: 1920 },
    assets: [{ checksum: "3".repeat(64), durationSeconds: 20, fileSizeBytes: 4, mimeType: "audio/mpeg", productionAssetId: "00000000-0000-4000-8000-000000000033", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/music.mp3", timelineRole: "AUDIO" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 20, subtitle: "Prueba", title: "Música" },
  });
  const music = document.tracks.find((track) => track.id === "music")!;
  Object.assign(music, { hidden: true, locked: true, muted: true, volume: 0.4 });

  const normalized = normalizeCompositionTrackTopology(document, new Map([["00000000-0000-4000-8000-000000000033", "AUDIO"]]));
  const stored = normalized.tracks.find((track) => track.id === "music")!;

  assert.deepEqual({ hidden: stored.hidden, locked: stored.locked, muted: stored.muted, volume: stored.volume }, { hidden: true, locked: true, muted: true, volume: 0.4 });
});

test("preserves the production asset name so an avatar clip is identifiable in the timeline", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "d".repeat(64),
      durationSeconds: 8,
      fileSizeBytes: 40,
      label: "Presentador avatar.mp4",
      mimeType: "video/mp4",
      productionAssetId: "00000000-0000-4000-8000-000000000005",
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: "production-assets/avatar.mp4",
      timelineRole: "AVATAR",
      timelineVariant: "FULL",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Avatar" },
  });

  assert.equal(document.clips[0]?.label, "Presentador avatar.mp4");
  assert.equal(document.clips[0]?.layout.zIndex, 2);
});

test("uses source durations for the base template and distributes b-roll clips", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [
      { checksum: "a".repeat(64), durationSeconds: 160, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000010", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/avatar.mp4", timelineRole: "AVATAR" },
      { checksum: "b".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000011", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/broll-1.mp4", timelineRole: "BROLL" },
      { checksum: "c".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000012", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/broll-2.mp4", timelineRole: "BROLL" },
    ],
    plan: { accentColor: "#38BDF8", durationSeconds: 75, subtitle: "Prueba", title: "Plantilla" },
  });
  const avatar = document.clips.find((clip) => clip.trackId === "avatar")!;
  const broll = document.clips.filter((clip) => clip.trackId === "broll").sort((left, right) => left.startSeconds - right.startSeconds);

  assert.equal(document.canvas.durationSeconds, 160);
  assert.equal(avatar.durationSeconds, 160);
  assert.equal(avatar.startSeconds, 0);
  assert.equal(broll[0]?.durationSeconds, 8);
  assert.equal(broll[1]?.startSeconds, 8);
});

test("hashes one document deterministically regardless of object key order", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "b".repeat(64), durationSeconds: 5, fileSizeBytes: 4, mimeType: "image/png",
      productionAssetId: "00000000-0000-4000-8000-000000000003", publicUrl: null,
      storageBucket: "production-assets", storagePath: "production-assets/image.png", timelineRole: "BROLL",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Imagen" },
  });
  const reordered = JSON.parse(JSON.stringify(document));
  reordered.variables = { title: document.variables.title, accent: document.variables.accent, subtitle: document.variables.subtitle };
  assert.equal(hashCompositionDocument(document), hashCompositionDocument(reordered));
});

test("resolves duration with the strict voice, avatar, b-roll and slides priority", () => {
  assert.deepEqual(resolveCompositionDuration({
    assets: [
      { durationSeconds: 70, timelineRole: "VOICE" },
      { durationSeconds: 90, timelineRole: "AVATAR", timelineVariant: "FULL" },
      { durationSeconds: 20, timelineRole: "BROLL" },
      { durationSeconds: 500, timelineRole: "VISUAL" },
    ],
    slideCount: 30,
  }), { durationSeconds: 70, source: "voice" });

  assert.deepEqual(resolveCompositionDuration({
    assets: [
      { durationSeconds: 30, timelineRole: "AVATAR", timelineVariant: "CLIP" },
      { durationSeconds: 45, timelineRole: "AVATAR", timelineVariant: "CLIP" },
      { durationSeconds: 20, timelineRole: "BROLL" },
    ],
    slideCount: 30,
  }), { durationSeconds: 75, source: "avatar_clips" });

  assert.deepEqual(resolveCompositionDuration({
    assets: [{ durationSeconds: 8, timelineRole: "BROLL" }, { durationSeconds: 7, timelineRole: "BROLL" }],
    slideCount: 30,
  }), { durationSeconds: 15, source: "b_roll" });

  assert.deepEqual(resolveCompositionDuration({ assets: [], slideCount: 3 }), {
    durationSeconds: 15,
    source: "slides",
  });
});

test("rejects a composition without an eligible duration source", () => {
  assert.throws(
    () => resolveCompositionDuration({
      assets: [{ durationSeconds: 99, timelineRole: "VISUAL" }],
      slideCount: 0,
    }),
    CompositionDurationResolutionError,
  );
});

test("places multiple avatar clips consecutively and records their source duration", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [
      { checksum: "1".repeat(64), durationSeconds: 12, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000021", publicUrl: null, storageBucket: "production-assets", storagePath: "avatar-1.mp4", timelineRole: "AVATAR", timelineVariant: "CLIP" },
      { checksum: "2".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000022", publicUrl: null, storageBucket: "production-assets", storagePath: "avatar-2.mp4", timelineRole: "AVATAR", timelineVariant: "CLIP" },
    ],
    plan: { accentColor: "#38BDF8", durationSeconds: 999, subtitle: "Prueba", title: "Avatar" },
  });
  const avatarClips = document.clips.filter((clip) => clip.trackId === "avatar");

  assert.equal(document.canvas.durationSeconds, 20);
  assert.equal(document.canvas.durationSource, "avatar_clips");
  assert.deepEqual(avatarClips.map((clip) => clip.startSeconds), [0, 12]);
  assert.deepEqual(avatarClips.map((clip) => clip.sourceDurationSeconds), [12, 8]);
});

test("reconciles newly available avatar media into an existing draft document", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: ".slide { color: white; }",
      fonts: [],
      height: 1080,
      slides: [{ animationCount: 1, classes: "slide", html: "<h1>Uno</h1>", index: 0, label: "Uno" }],
      width: 1920,
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Deck" },
  });
  const avatarAsset = {
    checksum: "c".repeat(64),
    fileSizeBytes: 120,
    mimeType: "video/mp4",
    productionAssetId: "00000000-0000-4000-8000-000000000004",
    publicUrl: null,
    storageBucket: "production-assets",
    storagePath: "production-assets/heygen/avatar.mp4",
  };

  const reconciled = appendMissingProductionAssetClips(document, [avatarAsset]);
  const secondPass = appendMissingProductionAssetClips(reconciled.document, [avatarAsset]);

  assert.equal(reconciled.changed, true);
  assert.equal(secondPass.changed, false);
  assert.equal(
    reconciled.document.clips.some((clip) => (
      clip.source.type === "PRODUCTION_ASSET"
      && clip.source.productionAssetId === avatarAsset.productionAssetId
    )),
    true,
  );
  assert.equal(reconciled.document.tracks.some((track) => track.id === "visual"), true);
});

test("reconciliation prefers one full avatar over its generated fragments", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: { css: "", fonts: [], height: 1080, slides: [{ animationCount: 0, classes: "slide", html: "<h1>Uno</h1>", index: 0, label: "Uno" }], width: 1920 },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 5, subtitle: "Prueba", title: "Deck" },
  });
  const assets = [
    { checksum: "1".repeat(64), durationSeconds: 40, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000041", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/avatar-full.mp4", timelineRole: "AVATAR" as const, timelineVariant: "FULL" as const },
    { checksum: "2".repeat(64), durationSeconds: 10, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000042", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/avatar-clip.mp4", timelineRole: "AVATAR" as const, timelineVariant: "CLIP" as const },
  ];

  const reconciled = appendMissingProductionAssetClips(document, assets);
  const avatarIds = reconciled.document.clips.flatMap((clip) => (
    clip.trackId === "avatar" && clip.source.type === "PRODUCTION_ASSET"
      ? [clip.source.productionAssetId]
      : []
  ));

  assert.deepEqual(avatarIds, [assets[0]!.productionAssetId]);
});

test("reconciles an unframed legacy B-roll to full-source fit without overriding authored crop", () => {
  const asset = {
    checksum: "8".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4",
    productionAssetId: "00000000-0000-4000-8000-000000000098", publicUrl: null,
    sourceHeight: 1920, sourceWidth: 1080, storageBucket: "production-assets",
    storagePath: "production-assets/legacy-vertical.mp4", timelineRole: "BROLL" as const,
  };
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ ...asset, sourceHeight: undefined, sourceWidth: undefined }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Legacy" },
  });
  delete document.clips[0]!.mediaFit;
  const reconciled = reconcileCompositionDocument({
    deckDependencyAssetIds: new Set(),
    document,
    productionAssets: [asset],
  });
  const clip = reconciled.document.clips[0]!;

  assert.equal(reconciled.changed, true);
  assert.equal(clip.mediaFit, "CONTAIN");
  assert.deepEqual(clip.layout, { height: 1080, opacity: 1, rotation: 0, width: 608, x: 656, y: 0, zIndex: 2 });

  const croppedDocument = structuredClone(document);
  croppedDocument.clips[0]!.crop = { bottom: 10, left: 10, right: 10, top: 10 };
  const cropped = reconcileCompositionDocument({
    deckDependencyAssetIds: new Set(),
    document: croppedDocument,
    productionAssets: [asset],
  }).document.clips[0]!;
  assert.equal(cropped.mediaFit, undefined);
  assert.deepEqual(cropped.layout, croppedDocument.clips[0]!.layout);
});

test("removes only deck-owned raster assets from an existing timeline", () => {
  const deckAssetId = "00000000-0000-4000-8000-000000000006";
  const avatarAssetId = "00000000-0000-4000-8000-000000000007";
  const document = createInitialCompositionDocument({
    animatedDeck: { css: ".slide { color: white; }", fonts: [], height: 1080, slides: [{ animationCount: 0, classes: "slide active", html: "<h1>Uno</h1>", index: 1, label: "Uno" }], width: 1920 },
    assets: [
      { checksum: "e".repeat(64), fileSizeBytes: 4, mimeType: "image/png", productionAssetId: deckAssetId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/slides/slide.png" },
      { checksum: "f".repeat(64), fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: avatarAssetId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/avatar.mp4", timelineRole: "AVATAR" },
    ],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Deck" },
  });
  const reconciled = reconcileCompositionDocument({
    deckDependencyAssetIds: new Set([deckAssetId]),
    document,
    productionAssets: [{ checksum: "f".repeat(64), fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: avatarAssetId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/avatar.mp4", timelineRole: "AVATAR" }],
  });

  assert.equal(reconciled.removedDeckDependencyCount, 1);
  assert.equal(reconciled.document.clips.some((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.productionAssetId === deckAssetId), false);
  assert.equal(reconciled.document.clips.some((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.productionAssetId === avatarAssetId && clip.trackId === "avatar"), true);
});

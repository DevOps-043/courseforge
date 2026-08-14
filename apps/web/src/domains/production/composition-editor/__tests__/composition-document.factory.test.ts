import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMissingProductionAssetClips,
  createInitialCompositionDocument,
  reconcileCompositionDocument,
} from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";

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
  assert.match(document.clips[0]?.source.html || "", /<h1>Uno<\/h1>/);
  assert.equal(document.clips[1]?.startSeconds, 5);
});

test("keeps production media as references instead of copying files", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "a".repeat(64),
      fileSizeBytes: 40,
      mimeType: "video/mp4",
      productionAssetId: "00000000-0000-4000-8000-000000000001",
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: "production-assets/demo.mp4",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Video" },
  });

  assert.equal(document.clips[0]?.source.type, "PRODUCTION_ASSET");
  assert.equal(document.clips[0]?.source.productionAssetId, "00000000-0000-4000-8000-000000000001");
});

test("preserves the production asset name so an avatar clip is identifiable in the timeline", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "d".repeat(64),
      fileSizeBytes: 40,
      label: "Presentador avatar.mp4",
      mimeType: "video/mp4",
      productionAssetId: "00000000-0000-4000-8000-000000000005",
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: "production-assets/avatar.mp4",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Avatar" },
  });

  assert.equal(document.clips[0]?.label, "Presentador avatar.mp4");
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
      checksum: "b".repeat(64), fileSizeBytes: 4, mimeType: "image/png",
      productionAssetId: "00000000-0000-4000-8000-000000000003", publicUrl: null,
      storageBucket: "production-assets", storagePath: "production-assets/image.png",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Imagen" },
  });
  const reordered = JSON.parse(JSON.stringify(document));
  reordered.variables = { title: document.variables.title, accent: document.variables.accent, subtitle: document.variables.subtitle };
  assert.equal(hashCompositionDocument(document), hashCompositionDocument(reordered));
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

import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../../composition-editor/composition-document.factory";
import { applyCompositionEditorPatches } from "../../composition-editor/editor-patch.service";
import {
  assertSafeDraftRelativePath,
  buildProductionAssetReconciliationOperations,
  contentVersion,
  studioProjectDescriptor,
} from "../hyperframes-draft.service";

test("creates a Studio-safe descriptor without exposing a storage path", () => {
  assert.deepEqual(studioProjectDescriptor("ea635d7c-2dd0-4214-a0df-1fc3cedcc05e", 4), {
    draftId: "ea635d7c-2dd0-4214-a0df-1fc3cedcc05e",
    projectId: "ea635d7c-2dd0-4214-a0df-1fc3cedcc05e",
    version: 4,
  });
});

test("rejects traversal paths and versions file contents", () => {
  assert.equal(assertSafeDraftRelativePath("scenes/intro.html"), "scenes/intro.html");
  assert.throws(() => assertSafeDraftRelativePath("../secrets.txt"));
  assert.throws(() => assertSafeDraftRelativePath("/absolute.html"));
  assert.equal(contentVersion("same"), contentVersion("same"));
  assert.notEqual(contentVersion("same"), contentVersion("different"));
});

test("reconciles an existing draft with the active Production avatar only", () => {
  const staleAssetId = "00000000-0000-4000-8000-000000000051";
  const avatarAssetId = "00000000-0000-4000-8000-000000000052";
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: "",
      fonts: [],
      height: 1080,
      slides: [{ animationCount: 0, classes: "slide", html: "<h1>Uno</h1>", index: 0, label: "Uno" }],
      width: 1920,
    },
    assets: [{
      checksum: "1".repeat(64),
      durationSeconds: 8,
      fileSizeBytes: 4,
      mimeType: "video/mp4",
      productionAssetId: staleAssetId,
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: "production-assets/old-broll.mp4",
      timelineRole: "BROLL",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Draft" },
  });
  document.clips[0]!.layout.x = 123;
  document.clips[0]!.timingSource = "USER_EDITED";
  document.canvas.fps = 30;

  const operations = buildProductionAssetReconciliationOperations(document, [{
    checksum: "2".repeat(64),
    durationSeconds: 30,
    fileSizeBytes: 4,
    hasAudio: true,
    mimeType: "video/mp4",
    productionAssetId: avatarAssetId,
    publicUrl: null,
    storageBucket: "production-assets",
    storagePath: "production-assets/avatar.mp4",
    timelineRole: "AVATAR",
    timelineVariant: "FULL",
  }]);
  assert.throws(
    () => applyCompositionEditorPatches(document, operations),
    /exclusiva del sistema/,
  );
  const reconciled = applyCompositionEditorPatches(document, operations, "SYSTEM");

  assert.deepEqual(operations.map((operation) => operation.type), ["document.reconcile"]);
  assert.equal(reconciled.canvas.fps, 25);
  assert.equal(reconciled.clips.some((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.productionAssetId === staleAssetId), false);
  assert.equal(reconciled.clips.some((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.productionAssetId === avatarAssetId && clip.trackId === "avatar"), true);
  const avatar = reconciled.clips.find((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.productionAssetId === avatarAssetId);
  assert.equal(avatar?.source.type === "PRODUCTION_ASSET" ? avatar.source.hasAudio : undefined, true);
  assert.equal(reconciled.clips.find((clip) => clip.source.type === "DECK_SLIDE")?.layout.x, 123);
  assert.equal(reconciled.clips.find((clip) => clip.source.type === "DECK_SLIDE")?.timingSource, "USER_EDITED");
});

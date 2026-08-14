import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compileCompositionPreview } from "../composition-preview-compiler.service";

test("compiles the native document into a seekable preview with stable visual ids", async () => {
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: ".slide { color: white; }", fonts: [], height: 1080, width: 1920,
      slides: [{ animationCount: 1, classes: "slide", html: "<h1>Uno</h1>", index: 0, label: "Uno" }],
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Deck" },
  });
  const html = await compileCompositionPreview({ assetUrls: new Map(), document });

  assert.match(html, /data-composition-id="courseforge-composition"/);
  assert.match(html, /data-hf-id="deck-slide-0"/);
  assert.match(html, /window\.__timelines\["courseforge-composition"\]/);
  assert.match(html, /courseforge-composition-selection/);
  assert.match(html, /composition-viewport/);
  assert.match(html, /fitCompositionToViewport/);
  assert.match(html, /class="deck-scope"/);
  assert.match(html, /<section class="slide">/);
  assert.match(html, /<h1>Uno<\/h1>/);
});

test("fails closed when a document references an asset without a preview URL", async () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "a".repeat(64), fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000004", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/video.mp4" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Video" },
  });
  await assert.rejects(() => compileCompositionPreview({ assetUrls: new Map(), document }));
});

test("creates a separate synchronized audio element for an avatar video", async () => {
  const avatarId = "00000000-0000-4000-8000-000000000005";
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "b".repeat(64), durationSeconds: 30, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: avatarId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/avatar.mp4", timelineRole: "AVATAR" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Avatar" },
  });
  const html = await compileCompositionPreview({ assetUrls: new Map([[avatarId, "https://example.test/avatar.mp4"]]), document });
  assert.match(html, /asset-00000000-0000-4000-8000-000000000005-audio/);
  assert.match(html, /data-volume="1"/);
});

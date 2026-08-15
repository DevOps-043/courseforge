import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { buildInternalHyperframesDraftSource, buildInternalHyperframesProject } from "../hyperframes-project-builder.service";

describe("HyperFrames internal project builder", () => {
  it("packages selected media and emits deterministic self-contained HTML", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const project = await buildInternalHyperframesProject({
      assets: [{
        checksum: createHash("sha256").update(bytes).digest("hex"),
        fileSizeBytes: bytes.byteLength,
        mimeType: "image/png",
        productionAssetId: "00000000-0000-4000-8000-000000000001",
        publicUrl: "https://example.supabase.co/storage/v1/object/public/production-assets/image.png",
        storageBucket: "production-assets",
        storagePath: "production-assets/image.png",
      }],
      downloadAsset: async () => bytes,
      plan: {
        accentColor: "#38BDF8",
        durationSeconds: 8,
        subtitle: "Subtítulo seguro",
        title: "Título seguro",
      },
    });
    const zip = await JSZip.loadAsync(project.archive);
    const html = await zip.file("index.html")!.async("string");

    assert.match(html, /data-composition-id="courseforge-internal"/);
    assert.match(html, /data-start="0"/);
    assert.match(html, /vendor\/gsap\.min\.js/);
    assert.match(html, /window\.__timelines\["courseforge-internal"\]/);
    assert.ok(zip.file("assets/00000000-0000-4000-8000-000000000001.png"));
    assert.ok(zip.file("vendor/gsap.min.js"));
    assert.match(project.previewHtml, /example\.supabase\.co/);
  });

  it("preserves animated deck HTML and exposes its preview timeline", async () => {
    const project = await buildInternalHyperframesProject({
      animatedDeck: {
        css: ".slide { opacity: calc(var(--deck-t) + .1); }",
        fonts: [],
        height: 1080,
        slides: [
          { animationCount: 2, classes: "slide", html: "<h1>Primera</h1>", index: 0, label: "Primera" },
          { animationCount: 1, classes: "slide", html: "<h1>Segunda</h1>", index: 1, label: "Segunda" },
        ],
        width: 1920,
      },
      assets: [],
      downloadAsset: async () => new Uint8Array(),
      plan: { accentColor: "#38BDF8", durationSeconds: 10, subtitle: "", title: "Deck" },
    });
    const zip = await JSZip.loadAsync(project.archive);
    const html = await zip.file("index.html")!.async("string");

    assert.match(html, /<h1>Primera<\/h1>/);
    assert.match(html, /class="deck-shell"/);
    assert.match(html, /class="deck-stage"/);
    assert.match(html, /data-deck-start="0"/);
    assert.match(html, /courseforge-preview-seek/);
    assert.equal(project.previewTimeline.tracks[0]?.segments.length, 2);
  });

  it("creates editable source without downloading assets or creating an archive", async () => {
    const draft = await buildInternalHyperframesDraftSource({
      assets: [{
        checksum: "a".repeat(64),
        fileSizeBytes: 4,
        mimeType: "video/mp4",
        productionAssetId: "00000000-0000-4000-8000-000000000002",
        publicUrl: null,
        storageBucket: "production-assets",
        storagePath: "production-assets/video.mp4",
      }],
      assetUrls: {
        "00000000-0000-4000-8000-000000000002": "/api/production/hyperframes/drafts/draft/assets/00000000-0000-4000-8000-000000000002",
      },
      plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Texto", title: "Editable" },
    });

    assert.equal(draft.entryPoint, "index.html");
    assert.match(draft.html, /data-composition-id="courseforge-internal"/);
    assert.match(draft.html, /\/api\/production\/hyperframes\/drafts\/draft\/assets/);
    assert.match(draft.html, /window\.__timelines\["courseforge-internal"\]/);
  });
});

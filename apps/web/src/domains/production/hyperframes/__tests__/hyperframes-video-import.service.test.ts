import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeHyperframesVideoUrl,
  buildCompletedRenderAssets,
} from "../hyperframes-video-import.service";

describe("HyperFrames final-video import", () => {
  it("only accepts HTTPS video URLs served by HeyGen", () => {
    assert.doesNotThrow(() => {
      assertSafeHyperframesVideoUrl("https://cdn.heygen.com/renders/final.mp4");
    });
    assert.doesNotThrow(() => {
      assertSafeHyperframesVideoUrl("https://heygen-product.s3.amazonaws.com/renders/final.mp4");
    });
    assert.throws(
      () => assertSafeHyperframesVideoUrl("https://cdn.heygen.com.evil.example/final.mp4"),
      /host permitido/i,
    );
    assert.throws(
      () => assertSafeHyperframesVideoUrl("http://cdn.heygen.com/final.mp4"),
      /HTTPS/i,
    );
    assert.throws(
      () => assertSafeHyperframesVideoUrl("https://untrusted-bucket.s3.amazonaws.com/final.mp4"),
      /host permitido/i,
    );
  });
});

describe("HyperFrames completed-render assets", () => {
  it("replaces the final video and clears stale markers from the prior render", () => {
    const nextAssets = buildCompletedRenderAssets(
      {
        final_video_assembly_stale: true,
        final_video_layout_stale: true,
        final_video_url: "https://example.test/old.mp4",
        slides_url: "https://example.test/slides",
      },
      {
        durationSeconds: 243.2,
        publicUrl: "https://example.test/new.mp4",
        storagePath: "production-videos/new.mp4",
      },
    );

    assert.equal(nextAssets.final_video_url, "https://example.test/new.mp4");
    assert.equal(nextAssets.video_duration, 243);
    assert.equal(nextAssets.production_status, "COMPLETED");
    assert.equal(nextAssets["slides_url"], "https://example.test/slides");
    assert.equal("final_video_assembly_stale" in nextAssets, false);
    assert.equal("final_video_layout_stale" in nextAssets, false);
  });
});

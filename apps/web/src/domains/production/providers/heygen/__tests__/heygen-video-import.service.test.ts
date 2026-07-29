import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSafeHeygenVideoUrl } from "../heygen-video-import.service";

describe("HeyGen video import safety", () => {
  it("allows HTTPS URLs from HeyGen-owned hosts", () => {
    assert.doesNotThrow(() =>
      assertSafeHeygenVideoUrl("https://files2.heygen.ai/videos/example.mp4"),
    );
    assert.doesNotThrow(() =>
      assertSafeHeygenVideoUrl("https://cdn.heygen.com/videos/example.webm"),
    );
  });

  it("rejects non-HTTPS and non-HeyGen hosts", () => {
    assert.throws(
      () => assertSafeHeygenVideoUrl("http://files2.heygen.ai/video.mp4"),
      /HTTPS/,
    );
    assert.throws(
      () => assertSafeHeygenVideoUrl("https://example.com/video.mp4"),
      /host permitido/,
    );
  });
});

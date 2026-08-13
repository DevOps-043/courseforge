import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSafeHyperframesVideoUrl } from "../hyperframes-video-import.service";

describe("HyperFrames final-video import", () => {
  it("only accepts HTTPS video URLs served by HeyGen", () => {
    assert.doesNotThrow(() => {
      assertSafeHyperframesVideoUrl("https://cdn.heygen.com/renders/final.mp4");
    });
    assert.throws(
      () => assertSafeHyperframesVideoUrl("https://cdn.heygen.com.evil.example/final.mp4"),
      /host permitido/i,
    );
    assert.throws(
      () => assertSafeHyperframesVideoUrl("http://cdn.heygen.com/final.mp4"),
      /HTTPS/i,
    );
  });
});

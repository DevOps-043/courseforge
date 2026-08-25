import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeHeygenVideoUrl,
  normalizeVideoContentType,
} from "../heygen-video-import.service";
import { assertSafeHeygenAudioUrl } from "../heygen-audio-import.service";

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

  it("normalizes the binary MIME returned by files2.heygen.ai", () => {
    assert.equal(
      normalizeVideoContentType(
        "binary/octet-stream",
        "https://files2.heygen.ai/videos/example.mp4",
      ),
      "video/mp4",
    );
    assert.equal(
      normalizeVideoContentType(
        "binary/octet-stream; charset=binary",
        "https://files2.heygen.ai/videos/example.webm",
      ),
      "video/webm",
    );
  });

  it("continues rejecting non-video MIME types", () => {
    assert.throws(
      () => normalizeVideoContentType(
        "text/html",
        "https://files2.heygen.ai/videos/example.mp4",
      ),
      /MIME type no permitido/,
    );
  });
});

describe("HeyGen separated voice import safety", () => {
  it("allows only HTTPS audio from explicitly trusted HeyGen hosts", () => {
    assert.doesNotThrow(() =>
      assertSafeHeygenAudioUrl("https://resource2.heygen.ai/text_to_speech/voice.wav"),
    );
    assert.throws(
      () => assertSafeHeygenAudioUrl("https://example.com/voice.mp3"),
      /host permitido/,
    );
    assert.throws(
      () => assertSafeHeygenAudioUrl("http://resource.heygen.ai/voice.mp3"),
      /HTTPS/,
    );
  });
});

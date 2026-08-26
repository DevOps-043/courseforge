import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatProductionMediaDuration,
  isAllowedProductionMediaSource,
} from "../production-media-preview";

describe("production media preview", () => {
  it("accepts authenticated internal delivery paths and HTTP(S) URLs", () => {
    assert.equal(isAllowedProductionMediaSource("/api/storage/media?path=music%2Ftrack.mp3"), true);
    assert.equal(isAllowedProductionMediaSource("https://cdn.example.com/video.mp4"), true);
    assert.equal(isAllowedProductionMediaSource("http://localhost:3000/video.mp4"), true);
  });

  it("rejects executable, protocol-relative, and malformed sources", () => {
    assert.equal(isAllowedProductionMediaSource("javascript:alert(1)"), false);
    assert.equal(isAllowedProductionMediaSource("//evil.example/video.mp4"), false);
    assert.equal(isAllowedProductionMediaSource("/api/admin/destructive-action"), false);
    assert.equal(isAllowedProductionMediaSource("https://user:password@example.com/video.mp4"), false);
    assert.equal(isAllowedProductionMediaSource("not a media URL"), false);
    assert.equal(isAllowedProductionMediaSource(""), false);
  });

  it("formats known durations without inventing missing metadata", () => {
    assert.equal(formatProductionMediaDuration(65.4), "1:05");
    assert.equal(formatProductionMediaDuration(0), null);
    assert.equal(formatProductionMediaDuration(undefined), null);
  });
});

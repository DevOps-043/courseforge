import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeDurableFinalVideoIntoAssets,
  type HyperframesDurableFinalVideo,
} from "../hyperframes-final-video.service";

const durableVideo: HyperframesDurableFinalVideo = {
  assetId: "asset-1",
  compositionRevisionId: "revision-1",
  createdAt: "2026-08-21T18:00:00Z",
  durationSeconds: 243,
  productionJobId: "job-1",
  publicUrl: "https://cdn.example.test/final.mp4",
  storagePath: "production-videos/final.mp4",
};

describe("HyperFrames durable final videos", () => {
  it("rehydrates missing projection fields from the durable asset", () => {
    const result = mergeDurableFinalVideoIntoAssets(
      { production_status: "IN_PROGRESS", slides_url: "https://slides.example.test" },
      durableVideo,
    );

    assert.equal(result.final_video_url, durableVideo.publicUrl);
    assert.equal(result.final_video_storage_path, durableVideo.storagePath);
    assert.equal(result.final_video_source, "hyperframes_cloud");
    assert.equal(result.production_status, "COMPLETED");
    assert.equal(result.video_duration, 243);
    assert.equal(result.slides_url, "https://slides.example.test");
  });

  it("does not replace a user-provided final video", () => {
    const result = mergeDurableFinalVideoIntoAssets(
      {
        final_video_source: "upload",
        final_video_url: "https://uploads.example.test/manual.mp4",
      },
      durableVideo,
    );

    assert.equal(
      result.final_video_url,
      "https://uploads.example.test/manual.mp4",
    );
    assert.equal(result.final_video_source, "upload");
  });
});

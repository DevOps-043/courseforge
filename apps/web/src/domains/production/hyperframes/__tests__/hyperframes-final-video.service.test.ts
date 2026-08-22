import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeDurableFinalVideoIntoAssets,
  type HyperframesDurableFinalVideo,
} from "../hyperframes-final-video.service";
import {
  HyperframesFinalVideoDeletionError,
  removeHyperframesFinalVideoProjection,
  resolveFinalVideoObjectPath,
} from "../hyperframes-final-video-deletion.service";

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

  it("clears only the HyperFrames final-video projection before deletion", () => {
    const result = removeHyperframesFinalVideoProjection(
      {
        final_video_asset_provider: "hyperframes",
        final_video_source: "hyperframes_cloud",
        final_video_storage_path: durableVideo.storagePath,
        final_video_url: durableVideo.publicUrl,
        production_status: "COMPLETED",
        slides_url: "https://slides.example.test",
        video_duration: 243,
      },
      {
        public_url: durableVideo.publicUrl,
        storage_path: durableVideo.storagePath,
      },
    );

    assert.equal("final_video_url" in result, false);
    assert.equal("final_video_storage_path" in result, false);
    assert.equal("video_duration" in result, false);
    assert.equal(result.production_status, "PENDING");
    assert.equal(result.slides_url, "https://slides.example.test");
  });

  it("does not clear a manual final-video projection", () => {
    const assets = {
      final_video_source: "upload",
      final_video_url: "https://uploads.example.test/manual.mp4",
      production_status: "COMPLETED",
    };
    const result = removeHyperframesFinalVideoProjection(assets, {
      public_url: durableVideo.publicUrl,
      storage_path: durableVideo.storagePath,
    });

    assert.equal(result, assets);
  });

  it("resolves only the managed object path for the requested lesson component", () => {
    const path = resolveFinalVideoObjectPath({
      artifactId: "artifact-1",
      componentId: "component-1",
      organizationId: "organization-1",
      storageBucket: "production-videos",
      storagePath: "production-videos/organizations/organization-1/artifacts/artifact-1/components/component-1/renders/request-1/final.mp4",
    });

    assert.equal(
      path,
      "organizations/organization-1/artifacts/artifact-1/components/component-1/renders/request-1/final.mp4",
    );
  });

  it("rejects a final-video path belonging to another lesson component", () => {
    assert.throws(
      () => resolveFinalVideoObjectPath({
        artifactId: "artifact-1",
        componentId: "component-1",
        organizationId: "organization-1",
        storageBucket: "production-videos",
        storagePath: "production-videos/organizations/organization-1/artifacts/artifact-1/components/component-2/renders/request-1/final.mp4",
      }),
      (error: unknown) => error instanceof HyperframesFinalVideoDeletionError
        && error.code === "HYPERFRAMES_FINAL_VIDEO_PATH_INVALID",
    );
  });
});

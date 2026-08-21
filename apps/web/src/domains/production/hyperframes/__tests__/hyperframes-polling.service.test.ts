import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideHyperframesPollingAction,
  isUnsubmittedRenderStale,
} from "../hyperframes-polling.service";

describe("HyperFrames polling decisions", () => {
  it("keeps queued and rendering jobs in the polling flow", () => {
    assert.equal(
      decideHyperframesPollingAction({ format: "mp4", render_id: "hfr_1", status: "queued" }).action,
      "WAIT",
    );
    assert.equal(
      decideHyperframesPollingAction({ format: "mp4", render_id: "hfr_1", status: "rendering" }).progressPercent,
      null,
    );
  });

  it("expires an upload that never receives a HeyGen render id", () => {
    const now = Date.parse("2026-08-21T18:00:00.000Z");
    assert.equal(isUnsubmittedRenderStale("2026-08-21T17:51:00.000Z", now), false);
    assert.equal(isUnsubmittedRenderStale("2026-08-21T17:50:00.000Z", now), true);
  });

  it("waits for a signed URL without inventing a failure and accepts completion with one", () => {
    assert.equal(
      decideHyperframesPollingAction({ format: "mp4", render_id: "hfr_1", status: "completed" }).action,
      "WAIT",
    );
    assert.equal(
      decideHyperframesPollingAction({
        format: "mp4",
        render_id: "hfr_1",
        status: "completed",
        video_url: "https://cdn.heygen.com/video.mp4",
      }).action,
      "COMPLETE",
    );
  });
});

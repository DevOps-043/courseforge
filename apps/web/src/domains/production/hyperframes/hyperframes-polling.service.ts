import type { HyperframesCloudRenderDetail } from "./hyperframes-cloud.client";

const UNSUBMITTED_RENDER_STALE_AFTER_MS = 10 * 60 * 1_000;

export type HyperframesPollingAction = "WAIT" | "COMPLETE" | "FAIL";

export interface HyperframesPollingDecision {
  action: HyperframesPollingAction;
  errorMessage: string | null;
  providerStatus: string;
  progressPercent: number;
}

export function isUnsubmittedRenderStale(updatedAt: string, nowMs = Date.now()) {
  const updatedAtMs = Date.parse(updatedAt);
  return Number.isFinite(updatedAtMs)
    && nowMs - updatedAtMs >= UNSUBMITTED_RENDER_STALE_AFTER_MS;
}

/** Maps the provider lifecycle into Courseforge's durable job lifecycle. */
export function decideHyperframesPollingAction(
  render: HyperframesCloudRenderDetail,
): HyperframesPollingDecision {
  switch (render.status) {
    case "queued":
      return {
        action: "WAIT",
        errorMessage: null,
        providerStatus: render.status,
        progressPercent: 15,
      };
    case "rendering":
      return {
        action: "WAIT",
        errorMessage: null,
        providerStatus: render.status,
        progressPercent: 65,
      };
    case "completed":
      return render.video_url
        ? {
            action: "COMPLETE",
            errorMessage: null,
            providerStatus: render.status,
            progressPercent: 90,
          }
        : {
            action: "FAIL",
            errorMessage: "HeyGen completó el render sin entregar una URL de video.",
            providerStatus: render.status,
            progressPercent: 100,
          };
    case "failed":
      return {
        action: "FAIL",
        errorMessage: render.failure_message || "HeyGen reportó el render de HyperFrames como fallido.",
        providerStatus: render.status,
        progressPercent: 100,
      };
  }
}

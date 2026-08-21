import type { HyperframesCloudRenderDetail } from "./hyperframes-cloud.client";

export type HyperframesPollingAction = "WAIT" | "COMPLETE" | "FAIL";

export interface HyperframesPollingDecision {
  action: HyperframesPollingAction;
  errorMessage: string | null;
  providerStatus: string;
  progressPercent: number | null;
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
        progressPercent: null,
      };
    case "rendering":
      return {
        action: "WAIT",
        errorMessage: null,
        providerStatus: render.status,
        progressPercent: null,
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
            action: "WAIT",
            errorMessage: null,
            providerStatus: render.status,
            progressPercent: null,
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

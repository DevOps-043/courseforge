export type HyperframesStatus = "queued" | "rendering" | "completed" | "failed";

export interface HyperframesRenderDetail {
  duration?: number | null;
  failure_message?: string | null;
  format?: "mp4" | "webm" | "mov";
  render_id: string;
  status: HyperframesStatus;
  video_url?: string | null;
}

export async function getHyperframesRender(
  apiKey: string,
  renderId: string,
): Promise<HyperframesRenderDetail> {
  const response = await fetch(
    `https://api.heygen.com/v3/hyperframes/renders/${encodeURIComponent(renderId)}`,
    {
      headers: { Accept: "application/json", "X-Api-Key": apiKey },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw await toHeygenError(response);
  const payload = await response.json() as { data?: HyperframesRenderDetail } | HyperframesRenderDetail;
  const detail = "data" in payload && payload.data ? payload.data : payload as HyperframesRenderDetail;
  if (!detail.render_id || !["queued", "rendering", "completed", "failed"].includes(detail.status)) {
    throw new Error("HeyGen returned an invalid HyperFrames render response.");
  }
  return detail;
}

export class HeygenHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function toHeygenError(response: Response): Promise<HeygenHttpError> {
  let message = `HeyGen request failed (${response.status}).`;
  try {
    const body = await response.json() as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") message = body.error.message;
  } catch {
    // Keep the safe status-only fallback; never log a provider response body.
  }
  return new HeygenHttpError(`HeyGen GET render: HTTP ${response.status}. ${message}`, response.status);
}

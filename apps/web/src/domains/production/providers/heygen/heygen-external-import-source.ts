import type { HeygenVideoDetails } from "./heygen.types";

export type ExternalVideoSource =
  | { status: "ready"; url: string }
  | { status: "pending" }
  | { status: "failed" }
  | { status: "missing" };

/** La URL explícita permite importar medios sin consultar la cuenta del proveedor. */
export async function resolveExternalVideoSource(
  input: { provider: "heygen" | "custom"; videoId?: string; videoUrl?: string },
  getHeygenVideo: (videoId: string) => Promise<HeygenVideoDetails>,
): Promise<ExternalVideoSource> {
  const idIsUrl = input.videoId?.startsWith("https://") || input.videoId?.startsWith("http://");
  const directUrl = idIsUrl ? input.videoId : input.videoUrl;
  if (directUrl) return { status: "ready", url: directUrl };
  if (input.provider !== "heygen" || !input.videoId) return { status: "missing" };

  const video = await getHeygenVideo(input.videoId);
  if (video.status === "failed") return { status: "failed" };
  if (video.status !== "completed" || !video.videoUrl) return { status: "pending" };
  return { status: "ready", url: video.videoUrl };
}

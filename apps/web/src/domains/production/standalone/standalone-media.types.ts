import { z } from "zod";

export const STANDALONE_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
export const STANDALONE_HTML_MAX_BYTES = 650_000;
export const standaloneMediaInputSchema = z.object({
  componentId: z.string().uuid(),
  assetId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  extension: z.enum(["png", "jpg", "jpeg", "mp4", "webm", "mp3", "wav", "html", "htm"]),
}).strict();

export const STANDALONE_MEDIA_MIME = {
  html: "text/html", htm: "text/html",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
} as const;

export interface StandaloneMediaSummary {
  id: string;
  name: string;
  mimeType: string;
  durationSeconds: number | null;
}

export function standaloneMediaPath(input: Pick<z.infer<typeof standaloneMediaInputSchema>, "componentId" | "assetId" | "extension">) {
  return `media/${input.componentId}-${input.assetId}.${input.extension}`;
}


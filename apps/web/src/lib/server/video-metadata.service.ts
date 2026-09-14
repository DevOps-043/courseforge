import { fetchIdempotentWithRetry } from "./outbound-http";

const MAX_VIMEO_METADATA_BYTES = 128 * 1024;
const MAX_YOUTUBE_PAGE_BYTES = 2 * 1024 * 1024;

async function readTextWithinLimit(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("VIDEO_METADATA_RESPONSE_TOO_LARGE");
  }
  if (!response.body) throw new Error("VIDEO_METADATA_EMPTY_RESPONSE");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("VIDEO_METADATA_RESPONSE_TOO_LARGE");
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function parseIsoDuration(duration: string) {
  const matches = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!matches) return 0;
  return (Number(matches[1] || 0) * 3600)
    + (Number(matches[2] || 0) * 60)
    + Number(matches[3] || 0);
}

export function extractYouTubeMetadataFromHtml(text: string) {
  const titleMatch = text.match(/<title>([^<]*)<\/title>/);
  const title = titleMatch ? titleMatch[1].replace(" - YouTube", "") : "";
  const seconds = text.match(/"lengthSeconds":"(\d+)"/)?.[1]
    || text.match(/"videoDurationSeconds":(\d+)/)?.[1]
    || text.match(/"videoDurationSeconds":"(\d+)"/)?.[1];
  if (seconds) return { duration: Number(seconds), title };

  const milliseconds = text.match(/"approxDurationMs":"(\d+)"/)?.[1];
  if (milliseconds) return { duration: Math.round(Number(milliseconds) / 1000), title };

  const isoDuration = text.match(/itemprop="duration" content="([^"]+)"/)?.[1];
  return { duration: isoDuration ? parseIsoDuration(isoDuration) : 0, title };
}

export async function fetchVideoMetadata(url: string) {
  const isVimeo = new URL(url).hostname === "vimeo.com";
  const response = await fetchIdempotentWithRetry(
    isVimeo ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}` : url,
    isVimeo ? {} : {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "User-Agent": "Mozilla/5.0 Courseforge/1.0",
      },
    },
    { attempts: 3, perAttemptTimeoutMilliseconds: 8_000, totalTimeoutMilliseconds: 20_000 },
  );
  if (!response.ok) throw new Error(`VIDEO_METADATA_HTTP_${response.status}`);

  const text = await readTextWithinLimit(
    response,
    isVimeo ? MAX_VIMEO_METADATA_BYTES : MAX_YOUTUBE_PAGE_BYTES,
  );
  if (!isVimeo) return extractYouTubeMetadataFromHtml(text);

  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("VIDEO_METADATA_INVALID_RESPONSE");
  const record = value as Record<string, unknown>;
  if (typeof record.duration !== "number" || !Number.isFinite(record.duration) || record.duration < 0) {
    throw new Error("VIDEO_METADATA_INVALID_RESPONSE");
  }
  return {
    duration: record.duration,
    title: typeof record.title === "string" ? record.title.slice(0, 500) : "",
  };
}

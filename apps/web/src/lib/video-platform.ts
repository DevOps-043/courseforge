export type VideoProvider = "youtube" | "vimeo" | "direct";
export const PRODUCTION_VIDEOS_BUCKET = "production-videos";
export const MAX_VIDEO_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;

const YOUTUBE_REGEX =
  /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
const VIMEO_REGEX =
  /vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^\/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)/;

export function detectVideoProvider(url: string): {
  provider: "youtube" | "vimeo" | null;
  id: string;
} {
  const ytMatch = url.match(YOUTUBE_REGEX);
  if (ytMatch?.[1]) {
    return { provider: "youtube", id: ytMatch[1] };
  }

  const vimeoMatch = url.match(VIMEO_REGEX);
  if (vimeoMatch?.[1]) {
    return { provider: "vimeo", id: vimeoMatch[1] };
  }

  return { provider: null, id: url };
}

export function getVideoProviderAndId(url: string): {
  provider: VideoProvider;
  id: string;
} {
  const detected = detectVideoProvider(url);
  if (!detected.provider) {
    return { provider: "direct", id: url };
  }

  return {
    provider: detected.provider,
    id: detected.id,
  };
}

export function buildVideoUrl(provider: VideoProvider, value: string): string {
  if (provider === "youtube" && !value.includes("http")) {
    return `https://www.youtube.com/watch?v=${value}`;
  }

  if (provider === "vimeo" && !value.includes("http")) {
    return `https://vimeo.com/${value}`;
  }

  return value;
}

export function getEmbedVideoUrl(url?: string): {
  isEmbed: boolean;
  url: string;
} {
  if (!url) return { isEmbed: false, url: "" };

  const detected = detectVideoProvider(url);
  if (detected.provider === "youtube") {
    return {
      isEmbed: true,
      url: `https://www.youtube.com/embed/${detected.id}`,
    };
  }

  if (detected.provider === "vimeo") {
    return {
      isEmbed: true,
      url: `https://player.vimeo.com/video/${detected.id}`,
    };
  }

  return { isEmbed: false, url };
}

function parseISODuration(duration: string): number {
  const matches = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!matches) return 0;

  const hours = parseInt(matches[1] || "0", 10);
  const minutes = parseInt(matches[2] || "0", 10);
  const seconds = parseInt(matches[3] || "0", 10);

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Client-safe version of fetchVideoMetadata.
 * Proxies the request through /api/video-metadata to avoid CORS restrictions
 * when called from the browser.
 */
export async function fetchVideoMetadataClient(
    url: string,
): Promise<{ duration: number; title: string }> {
    if (!url) return { duration: 0, title: '' };

    const response = await fetch(
        `/api/video-metadata?url=${encodeURIComponent(url)}`,
    );

    if (!response.ok) {
        return { duration: 0, title: '' };
    }

    return response.json() as Promise<{ duration: number; title: string }>;
}

/** Server-only: fetches video metadata directly from YouTube/Vimeo. Do not call from client components. */
export async function fetchVideoMetadata(url: string) {
  if (!url) return { duration: 0, title: "" };

  try {
    if (url.includes("vimeo.com")) {
      const response = await fetch(
        `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
      );
      if (response.ok) {
        const data = await response.json();
        return {
          duration: data.duration,
          title: data.title,
        };
      }
    }

    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      });
      const text = await response.text();
      const titleMatch = text.match(/<title>([^<]*)<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(" - YouTube", "") : "";

      // Most reliable pattern: lengthSeconds in ytInitialData JSON blob
      const lengthMatch = text.match(/"lengthSeconds":"(\d+)"/);
      if (lengthMatch?.[1]) {
        return {
          duration: parseInt(lengthMatch[1], 10),
          title,
        };
      }

      // Fallback: ISO 8601 duration in meta tag (older page versions)
      const metaMatch = text.match(/itemprop="duration" content="([^"]+)"/);
      if (metaMatch?.[1]) {
        return {
          duration: parseISODuration(metaMatch[1]),
          title,
        };
      }

      // Fallback: videoDurationSeconds in page JSON
      const jsonMatch = text.match(/"videoDurationSeconds":"(\d+)"/);
      if (jsonMatch?.[1]) {
        return {
          duration: parseInt(jsonMatch[1], 10),
          title,
        };
      }
    }
  } catch (error) {
    console.error("Error fetching video metadata:", error);
  }

  return { duration: 0, title: "" };
}

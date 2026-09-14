export type VideoProvider = "youtube" | "vimeo" | "direct";
export const PRODUCTION_VIDEOS_BUCKET = "production-videos";
/** Direct uploads are resumable (TUS); keep this aligned with the Storage bucket cap. */
export const MAX_VIDEO_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

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

export const HEYGEN_PUBLIC_RATES_USD = {
  aiClippingPerClip: 0.15,
  avatarIvDigitalTwinPerSecond: 0.0667,
  avatarIvPhotoPerSecond: 0.05,
  avatarVPerSecond: 0.0667,
  fillerRemovalPerSecond: 0.01,
  hyperframes1080p30PerMinute: 0.1,
  lipsyncPrecisionPerSecond: 0.0667,
  lipsyncSpeedPerSecond: 0.0333,
  translationPrecisionPerSecond: 0.0667,
  translationSpeedPerSecond: 0.0333,
  ttsPerSecond: 0.000667,
  videoAgentPerSecond: 0.0333,
} as const;

const NARRATION_WORDS_PER_MINUTE = 145;

export interface HeygenGenerationQuote {
  avatarUsd: number;
  durationSeconds: number;
  includesSpeech: boolean;
  speechUsd: number;
  totalUsd: number;
}

/**
 * Client-safe, indicative API quote. It deliberately models only the requests
 * SofLIA - Engine sends to HeyGen (speech and/or avatar video), never an avatar
 * for an audio-only request. Provider billing remains authoritative.
 */
export function estimateHeygenGenerationQuote(params: {
  avatarType?: string | null;
  engine?: "avatar_iv" | "avatar_v";
  includeSpeech: boolean;
  resolution?: "720p" | "1080p" | "4k";
  scripts: string[];
  speed?: number;
}): HeygenGenerationQuote {
  const speed = Math.max(0.5, params.speed || 1);
  const durationSeconds = Math.ceil(params.scripts.reduce((total, script) => {
    const words = script.trim().split(/\s+/).filter(Boolean).length;
    if (words === 0) return total;
    return total + Math.max(1, (words / NARRATION_WORDS_PER_MINUTE) * 60 / speed);
  }, 0));
  const avatarType = (params.avatarType || "").toLowerCase();
  const isPhotoAvatar = avatarType.includes("photo");
  const is4k = params.resolution === "4k";
  // HeyGen publishes Avatar IV API rates by look type. Avatar V does not yet
  // expose a separate public API table, so use the conservative Studio/Digital
  // Twin Avatar IV reference rate until the provider publishes one.
  const avatarRate = isPhotoAvatar
    ? (is4k ? 4 / 60 : 3 / 60)
    : (is4k ? 5 / 60 : 4 / 60);
  const avatarUsd = params.engine ? durationSeconds * avatarRate : 0;
  const speechUsd = params.includeSpeech
    ? durationSeconds * HEYGEN_PUBLIC_RATES_USD.ttsPerSecond
    : 0;

  return {
    avatarUsd: roundMoney(avatarUsd),
    durationSeconds,
    includesSpeech: params.includeSpeech,
    speechUsd: roundMoney(speechUsd),
    totalUsd: roundMoney(avatarUsd + speechUsd),
  };
}

export function estimateHeygenCost(params: {
  durationSeconds?: number | null;
  itemCount?: number;
  mode?: "precision" | "speed";
  operation:
    | "AI_CLIPPING"
    | "FILLER_REMOVAL"
    | "LIPSYNC"
    | "VIDEO_AGENT"
    | "VIDEO_TRANSLATION"
    | "VOICEOVER";
}) {
  const duration = Math.max(0, params.durationSeconds || 0);
  const items = Math.max(1, params.itemCount || 1);
  switch (params.operation) {
    case "AI_CLIPPING":
      return roundMoney(items * HEYGEN_PUBLIC_RATES_USD.aiClippingPerClip);
    case "FILLER_REMOVAL":
      return roundMoney(Math.max(60, duration) * HEYGEN_PUBLIC_RATES_USD.fillerRemovalPerSecond);
    case "LIPSYNC":
      return roundMoney(duration * (params.mode === "precision"
        ? HEYGEN_PUBLIC_RATES_USD.lipsyncPrecisionPerSecond
        : HEYGEN_PUBLIC_RATES_USD.lipsyncSpeedPerSecond));
    case "VIDEO_AGENT":
      return roundMoney(duration * HEYGEN_PUBLIC_RATES_USD.videoAgentPerSecond);
    case "VIDEO_TRANSLATION":
      return roundMoney(duration * items * (params.mode === "precision"
        ? HEYGEN_PUBLIC_RATES_USD.translationPrecisionPerSecond
        : HEYGEN_PUBLIC_RATES_USD.translationSpeedPerSecond));
    case "VOICEOVER":
      return roundMoney(duration * HEYGEN_PUBLIC_RATES_USD.ttsPerSecond);
  }
}

export function buildHybridCourseEstimate(params: {
  avatarSeconds?: number;
  durationSeconds: number;
  voiceoverSeconds?: number;
}) {
  const voiceoverSeconds = params.voiceoverSeconds ?? params.durationSeconds;
  return {
    avatarUsd: roundMoney(Math.max(0, params.avatarSeconds || 0) * HEYGEN_PUBLIC_RATES_USD.avatarIvPhotoPerSecond),
    hyperframesUsd: roundMoney((Math.max(0, params.durationSeconds) / 60) * HEYGEN_PUBLIC_RATES_USD.hyperframes1080p30PerMinute),
    totalUsd: roundMoney(
      Math.max(0, params.avatarSeconds || 0) * HEYGEN_PUBLIC_RATES_USD.avatarIvPhotoPerSecond
      + (Math.max(0, params.durationSeconds) / 60) * HEYGEN_PUBLIC_RATES_USD.hyperframes1080p30PerMinute
      + Math.max(0, voiceoverSeconds) * HEYGEN_PUBLIC_RATES_USD.ttsPerSecond,
    ),
    voiceoverUsd: roundMoney(Math.max(0, voiceoverSeconds) * HEYGEN_PUBLIC_RATES_USD.ttsPerSecond),
  };
}

function roundMoney(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

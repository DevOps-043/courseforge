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

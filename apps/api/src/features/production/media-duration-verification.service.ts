type MediaAsset = {
  public_url?: unknown;
  duration?: unknown;
  [key: string]: unknown;
};

type BrollAsset = MediaAsset & {
  id?: unknown;
  order?: unknown;
};

export type MediaDurationProbe = (url: string) => Promise<number | null>;

export interface DurationVerificationResult {
  assets: unknown;
  measuredDurations: Record<string, number>;
  failedMeasurements: string[];
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function readPublicUrl(asset: unknown): string | null {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
    return null;
  }

  const publicUrl = (asset as MediaAsset).public_url;
  return typeof publicUrl === 'string' && publicUrl.trim().length > 0
    ? publicUrl.trim()
    : null;
}

function normalizeMeasuredDurationSeconds(seconds: number): number {
  return Math.max(0.001, Math.floor(seconds * 1000) / 1000);
}

function stripUnverifiedDuration<T extends MediaAsset>(asset: T): T {
  const clone = { ...asset };
  delete clone.duration;
  return clone;
}

async function measureAssetDuration(params: {
  asset: MediaAsset | null | undefined;
  key: string;
  probe: MediaDurationProbe;
  measuredDurations: Record<string, number>;
  failedMeasurements: string[];
}): Promise<MediaAsset | null | undefined> {
  if (!params.asset || typeof params.asset !== 'object') {
    return params.asset;
  }

  const publicUrl = readPublicUrl(params.asset);
  if (!publicUrl) {
    return stripUnverifiedDuration(params.asset);
  }

  try {
    const measured = await params.probe(publicUrl);
    if (isPositiveFiniteNumber(measured)) {
      const measuredSeconds = normalizeMeasuredDurationSeconds(measured);
      params.measuredDurations[params.key] = measuredSeconds;
      return {
        ...params.asset,
        duration: measuredSeconds,
      };
    }
  } catch (error) {
    console.warn('[MediaDurationVerification] Could not measure asset duration.', {
      key: params.key,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  params.failedMeasurements.push(params.key);
  return stripUnverifiedDuration(params.asset);
}

export async function probeMediaDurationFromUrl(url: string): Promise<number | null> {
  const { ALL_FORMATS, Input, UrlSource } = await import('mediabunny');
  const input = new Input({
    source: new UrlSource(url, {
      parallelism: 1,
      getRetryDelay: (previousAttempts) => (previousAttempts < 1 ? 0.5 : null),
    }),
    formats: ALL_FORMATS,
  });

  try {
    const duration = await input.computeDuration();
    return isPositiveFiniteNumber(duration) ? duration : null;
  } finally {
    input.dispose();
  }
}

export async function verifyMediaDurationsFromUrls(
  rawAssets: unknown,
  probe: MediaDurationProbe = probeMediaDurationFromUrl,
): Promise<DurationVerificationResult> {
  if (!rawAssets || typeof rawAssets !== 'object' || Array.isArray(rawAssets)) {
    return {
      assets: rawAssets,
      measuredDurations: {},
      failedMeasurements: [],
    };
  }

  const source = rawAssets as Record<string, unknown>;
  const measuredDurations: Record<string, number> = {};
  const failedMeasurements: string[] = [];
  const nextAssets: Record<string, unknown> = { ...source };

  nextAssets.voice_audio = await measureAssetDuration({
    asset: source.voice_audio as MediaAsset | null | undefined,
    key: 'voice_audio',
    probe,
    measuredDurations,
    failedMeasurements,
  });

  nextAssets.avatar_video = await measureAssetDuration({
    asset: source.avatar_video as MediaAsset | null | undefined,
    key: 'avatar_video',
    probe,
    measuredDurations,
    failedMeasurements,
  });

  if (Array.isArray(source.b_roll_clips)) {
    nextAssets.b_roll_clips = await Promise.all(
      source.b_roll_clips.map((clip, index) => {
        const brollClip = clip as BrollAsset;
        const order =
          isPositiveFiniteNumber(brollClip.order)
            ? Math.round(brollClip.order)
            : index + 1;
        return measureAssetDuration({
          asset: brollClip,
          key: `b_roll_clips.${order}`,
          probe,
          measuredDurations,
          failedMeasurements,
        });
      }),
    );
  }

  if (Array.isArray(source.avatar_clips)) {
    nextAssets.avatar_clips = await Promise.all(
      source.avatar_clips.map((clip, index) => {
        const avatarClip = clip as BrollAsset;
        const order =
          isPositiveFiniteNumber(avatarClip.order)
            ? Math.round(avatarClip.order)
            : index + 1;
        return measureAssetDuration({
          asset: avatarClip,
          key: `avatar_clips.${order}`,
          probe,
          measuredDurations,
          failedMeasurements,
        });
      }),
    );
  }

  return {
    assets: nextAssets,
    measuredDurations,
    failedMeasurements,
  };
}

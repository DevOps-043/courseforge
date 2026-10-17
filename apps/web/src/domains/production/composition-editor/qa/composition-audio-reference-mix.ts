import { type CompositionVolumePoint } from "../composition-audio-mix.service";
import { stereoFloatWavHeader } from "./composition-pcm-wav";
import {
  buildCompositionPlaybackVolumeAutomations,
  resolvePlaybackVolume,
} from "../composition-playback-audio-envelope";
import { buildCompositionTransitionRuntime } from "../composition-transition-runtime";
import {
  compositionClipHasConfigurableAudio,
  resolveCompositionClipAudioVolume,
} from "../composition-clip-audio.service";
import {
  compositionEditorDocumentSchema,
  getCompositionClipMediaAssetId,
} from "../composition-document.types";
import { AUDIO_TIMING_POLICY } from "./composition-exported-audio-timing";
import { AUDIO_STREAM_LIMITS } from "./composition-audio-conformance-policy";

export const AUDIO_REFERENCE_LIMITS = {
  sampleRate: AUDIO_TIMING_POLICY.sampleRate,
  durationSeconds: AUDIO_TIMING_POLICY.maximumDurationSeconds,
  sourceSeconds: 600,
  clips: 64,
  decodedBytes: 128 * 1024 * 1024,
  automationPoints: 1024,
  sourceTextBytes: 20 * 1024 * 1024,
  decodeDeadlineMilliseconds: 10 * 60 * 1000,
} as const;
export interface AudioReferenceClip {
  clipId: string;
  assetId: string;
  startSeconds: number;
  durationSeconds: number;
  sourceOffsetSeconds: number;
  loop: boolean;
  volume: number;
  points: CompositionVolumePoint[];
}
export function buildAudioReferenceMixPlan(input: unknown) {
  const document = compositionEditorDocumentSchema.parse(input);
  if (document.canvas.durationSeconds > AUDIO_REFERENCE_LIMITS.durationSeconds)
    throw new Error("AUDIO_REFERENCE_DURATION_LIMIT");
  const runtime = buildCompositionTransitionRuntime(document);
  const tracks = new Map(document.tracks.map((track) => [track.id, track]));
  const automations = new Map(
    buildCompositionPlaybackVolumeAutomations(document, runtime).map(
      (automation) => [automation.targetClipId, automation.points],
    ),
  );
  const clips: AudioReferenceClip[] = [];
  for (const clip of document.clips) {
    const track = tracks.get(clip.trackId);
    if (
      clip.hidden ||
      track?.hidden ||
      track?.muted ||
      !(
        clip.kind === "AUDIO" ||
        (clip.kind === "VIDEO" &&
          compositionClipHasConfigurableAudio(clip, track))
      )
    )
      continue;
    const volume = resolveCompositionClipAudioVolume(clip, track);
    if (volume <= 0) continue;
    const assetId = getCompositionClipMediaAssetId(clip);
    if (!assetId) throw new Error("AUDIO_REFERENCE_ASSET_MISSING");
    // The preview's separate video audio element runs at 1x and loops, even for retimed visuals.
    const window = runtime.audioWindowsByClipId.get(clip.id)!;
    clips.push({
      clipId: clip.id,
      assetId,
      startSeconds: window.startSeconds,
      durationSeconds: window.durationSeconds,
      sourceOffsetSeconds: window.sourceOffsetSeconds,
      loop: clip.kind === "VIDEO",
      volume,
      points: automations.get(clip.id) || [],
    });
  }
  if (clips.length > AUDIO_REFERENCE_LIMITS.clips)
    throw new Error("AUDIO_REFERENCE_CLIP_LIMIT");
  return { durationSeconds: document.canvas.durationSeconds, clips };
}

/** Reference model, not a recording of browser playback. Inputs are packed stereo f32le at the policy sample rate. */
export function* iterateAudioReferencePcm(
  plan: ReturnType<typeof buildAudioReferenceMixPlan>,
  sources: ReadonlyMap<string, Buffer>,
) {
  const rate = AUDIO_REFERENCE_LIMITS.sampleRate;
  if (
    !Number.isFinite(plan.durationSeconds) ||
    plan.durationSeconds <= 0 ||
    plan.durationSeconds > AUDIO_REFERENCE_LIMITS.durationSeconds ||
    plan.clips.length > AUDIO_REFERENCE_LIMITS.clips
  )
    throw new Error("AUDIO_REFERENCE_PLAN_INVALID");
  for (const clip of plan.clips) {
    if (
      ![
        clip.startSeconds,
        clip.durationSeconds,
        clip.sourceOffsetSeconds,
        clip.volume,
      ].every(Number.isFinite) ||
      clip.startSeconds < 0 ||
      clip.durationSeconds <= 0 ||
      clip.sourceOffsetSeconds < 0 ||
      clip.volume < 0 ||
      clip.volume > 1 ||
      clip.points.length > AUDIO_REFERENCE_LIMITS.automationPoints ||
      clip.points.some(
        (point, index) =>
          !Number.isFinite(point.timeSeconds) ||
          point.timeSeconds < 0 ||
          !Number.isFinite(point.volume) ||
          point.volume < 0 ||
          point.volume > 1 ||
          (index > 0 &&
            point.timeSeconds < clip.points[index - 1]!.timeSeconds),
      )
    )
      throw new Error("AUDIO_REFERENCE_PLAN_INVALID");
  }
  let decodedBytes = 0;
  for (const bytes of sources.values()) {
    decodedBytes += bytes.length;
    if (
      !bytes.length ||
      bytes.length % 8 ||
      bytes.length > rate * AUDIO_REFERENCE_LIMITS.sourceSeconds * 8 ||
      decodedBytes > AUDIO_REFERENCE_LIMITS.decodedBytes
    )
      throw new Error("AUDIO_REFERENCE_PCM_LIMIT");
    for (let offset = 0; offset < bytes.length; offset += 4) {
      const sample = bytes.readFloatLE(offset);
      if (!Number.isFinite(sample) || Math.abs(sample) > 32)
        throw new Error("AUDIO_REFERENCE_PCM_INVALID");
    }
  }
  const frameCount = Math.ceil(plan.durationSeconds * rate);
  for (const clip of plan.clips)
    if (!sources.has(clip.assetId))
      throw new Error("AUDIO_REFERENCE_SOURCE_MISSING");
  for (
    let firstFrame = 0;
    firstFrame < frameCount;
    firstFrame += AUDIO_STREAM_LIMITS.mixChunkFrames
  ) {
    const chunkFrames = Math.min(
      AUDIO_STREAM_LIMITS.mixChunkFrames,
      frameCount - firstFrame,
    );
    const mixed = new Float64Array(chunkFrames * 2);
    for (const clip of plan.clips) {
      const source = sources.get(clip.assetId);
      if (!source) throw new Error("AUDIO_REFERENCE_SOURCE_MISSING");
      const sourceFrames = source.length / 8;
      for (
        let frame = Math.max(firstFrame, Math.ceil(clip.startSeconds * rate));
        frame <
        Math.min(
          firstFrame + chunkFrames,
          Math.ceil((clip.startSeconds + clip.durationSeconds) * rate),
        );
        frame++
      ) {
        const time = frame / rate;
        const rawPosition =
          (clip.sourceOffsetSeconds + time - clip.startSeconds) * rate;
        const position = clip.loop ? rawPosition % sourceFrames : rawPosition;
        if (position < 0 || position >= sourceFrames) continue;
        const left = Math.floor(position);
        const fraction = position - left;
        const right = clip.loop
          ? (left + 1) % sourceFrames
          : Math.min(sourceFrames - 1, left + 1);
        const gain = resolvePlaybackVolume(clip.points, time, clip.volume);
        for (let channel = 0; channel < 2; channel++) {
          const value = source.readFloatLE(left * 8 + channel * 4);
          const interpolated =
            value +
            (source.readFloatLE(right * 8 + channel * 4) - value) * fraction;
          mixed[(frame - firstFrame) * 2 + channel]! += interpolated * gain;
        }
      }
    }
    const pcm = Buffer.alloc(chunkFrames * 8);
    let peak = 0;
    for (let index = 0; index < mixed.length; index++) {
      const sample = mixed[index]!;
      peak = Math.max(peak, Math.abs(sample));
      // Do not normalize away an overdriven authored mix. Output a diagnostic failure.
      if (!Number.isFinite(sample) || Math.abs(sample) > 1)
        throw new Error("AUDIO_REFERENCE_MIX_CLIPPING");
      pcm.writeFloatLE(sample, index * 4);
    }
    yield { pcm, peak };
  }
}

/** Compatibility adapter for bounded local consumers. The producer writes the iterator directly to disk. */
export function mixAudioReferencePcm(
  plan: ReturnType<typeof buildAudioReferenceMixPlan>,
  sources: ReadonlyMap<string, Buffer>,
) {
  // Validate the duration before allocating; validation of sources remains in the iterator.
  if (
    !Number.isFinite(plan.durationSeconds) ||
    plan.durationSeconds <= 0 ||
    plan.durationSeconds > AUDIO_REFERENCE_LIMITS.durationSeconds
  ) {
    throw new Error("AUDIO_REFERENCE_PLAN_INVALID");
  }
  const pcm = Buffer.alloc(
    Math.ceil(plan.durationSeconds * AUDIO_REFERENCE_LIMITS.sampleRate) * 8,
  );
  let offset = 0,
    peak = 0;
  for (const chunk of iterateAudioReferencePcm(plan, sources)) {
    chunk.pcm.copy(pcm, offset);
    offset += chunk.pcm.length;
    peak = Math.max(peak, chunk.peak);
  }
  return { pcm, peak };
}

export function encodeAudioReferenceWav(pcm: Buffer) {
  return Buffer.concat([encodeAudioReferenceWavHeader(pcm.length), pcm]);
}

export function encodeAudioReferenceWavHeader(pcmBytes: number) {
  return stereoFloatWavHeader(pcmBytes, AUDIO_REFERENCE_LIMITS.sampleRate);
}

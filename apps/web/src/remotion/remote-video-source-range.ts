import { REMOTE_VIDEO_END_PADDING_FRAMES } from "./media-rendering.config";

export interface SafeRemoteVideoRange {
  sourceStartFrame: number;
  sourceEndFrame: number;
  sourceDurationInFrames: number;
  tailFreezeInFrames: number;
}

function normalizeFrame(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value as number)) : fallback;
}

export function resolveSafeRemoteVideoRange(params: {
  sourceStartFrame?: number;
  sourceEndFrame?: number;
  fallbackDurationInFrames: number;
  sequenceDurationInFrames: number;
}): SafeRemoteVideoRange {
  const sourceStartFrame = normalizeFrame(params.sourceStartFrame, 0);
  const fallbackEndFrame = sourceStartFrame + Math.max(1, Math.round(params.fallbackDurationInFrames));
  const requestedSourceEndFrame = Math.max(
    sourceStartFrame + 1,
    normalizeFrame(params.sourceEndFrame, fallbackEndFrame),
  );
  const requestedSourceDurationInFrames = requestedSourceEndFrame - sourceStartFrame;
  const shouldPadEnd = requestedSourceDurationInFrames > REMOTE_VIDEO_END_PADDING_FRAMES + 1;
  const sourceEndFrame = shouldPadEnd
    ? requestedSourceEndFrame - REMOTE_VIDEO_END_PADDING_FRAMES
    : requestedSourceEndFrame;
  const sourceDurationInFrames = Math.max(1, sourceEndFrame - sourceStartFrame);
  const sequenceDurationInFrames = Math.max(1, Math.round(params.sequenceDurationInFrames));

  return {
    sourceStartFrame,
    sourceEndFrame,
    sourceDurationInFrames,
    tailFreezeInFrames: Math.max(0, sequenceDurationInFrames - sourceDurationInFrames),
  };
}

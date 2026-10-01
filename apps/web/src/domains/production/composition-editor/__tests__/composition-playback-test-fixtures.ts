import { mediaBoundaryPlanHash, MEDIA_BOUNDARY_POLICY } from "../qa/composition-playback-boundaries";

export function playbackBoundaryFixture(durationSeconds: number, clipId = "voice", originFrame = 0) {
  const window = {clipId, elementId: clipId, startSeconds: 0, endSeconds: durationSeconds, sourceOffsetSeconds: 0, loop: false};
  return {policy: MEDIA_BOUNDARY_POLICY, planHash: mediaBoundaryPlanHash([window]), media: [{window, sourceDurationSeconds: durationSeconds,
    firstPlayingFrame: originFrame, stopFrame: originFrame + Math.round(durationSeconds * 48000), playingEvents: 1, stopEvents: 1, unexpectedStops: 0}]};
}

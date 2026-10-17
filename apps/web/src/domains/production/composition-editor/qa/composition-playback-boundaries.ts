import { createHash } from "node:crypto";
import { z } from "zod";
import { buildAudioReferenceMixPlan } from "./composition-audio-reference-mix";

export const MEDIA_BOUNDARY_POLICY = "browser-media-boundaries-v1" as const;
const seconds = z.number().finite().nonnegative();
const windowSchema = z.object({clipId: z.string().min(1).max(128), elementId: z.string().min(1).max(160),
  startSeconds: seconds, endSeconds: seconds, sourceOffsetSeconds: seconds, loop: z.boolean()}).strict()
  .refine((window) => window.endSeconds > window.startSeconds);
export const mediaBoundaryPlanSchema = z.array(windowSchema).max(64)
  .refine((windows) => new Set(windows.map((window) => window.elementId)).size === windows.length
    && new Set(windows.map((window) => window.clipId)).size === windows.length);
export type MediaBoundaryWindow = z.infer<typeof windowSchema>;
export const mediaBoundaryWitnessSchema = z.object({policy: z.literal(MEDIA_BOUNDARY_POLICY),
  planHash: z.string().regex(/^[a-f0-9]{64}$/), media: z.array(z.object({
    window: windowSchema, sourceDurationSeconds: seconds.nullable(), firstPlayingFrame: z.number().int().nonnegative().nullable(),
    stopFrame: z.number().int().nonnegative().nullable(), playingEvents: z.number().int().nonnegative(),
    stopEvents: z.number().int().nonnegative(), unexpectedStops: z.number().int().nonnegative(),
  }).strict()).max(64),
}).strict().refine((witness) => new Set(witness.media.map((entry) => entry.window.elementId)).size === witness.media.length
  && new Set(witness.media.map((entry) => entry.window.clipId)).size === witness.media.length);

export function mediaBoundaryPlanHash(input: unknown) {
  const windows = mediaBoundaryPlanSchema.parse(input).sort((left, right) => left.clipId < right.clipId ? -1 : left.clipId > right.clipId ? 1 : 0)
    .map(({clipId, elementId, startSeconds, endSeconds, sourceOffsetSeconds, loop}) => ({clipId, elementId, startSeconds, endSeconds, sourceOffsetSeconds, loop}));
  return createHash("sha256").update(JSON.stringify(windows)).digest("hex");
}
export function buildMediaBoundaryPlan(document: unknown) {
  const plan = buildAudioReferenceMixPlan(document);
  return mediaBoundaryPlanSchema.parse(plan.clips.filter((clip) => Math.max(0, clip.startSeconds)
    < Math.min(plan.durationSeconds, clip.startSeconds + clip.durationSeconds)).map((clip) => ({clipId: clip.clipId,
    elementId: clip.loop ? `${clip.clipId}-audio` : clip.clipId, startSeconds: Math.max(0, clip.startSeconds),
    endSeconds: Math.min(plan.durationSeconds, clip.startSeconds + clip.durationSeconds),
    sourceOffsetSeconds: clip.sourceOffsetSeconds + Math.max(0, -clip.startSeconds), loop: clip.loop})));
}

/** Self-contained so the identical reducer can run in trusted injected browser instrumentation. */
export function createMediaBoundaryTracker(windows: MediaBoundaryWindow[]) {
  const rows = windows.map((window) => ({window, sourceDurationSeconds: null as number | null,
    firstPlayingFrame: null as number | null, stopFrame: null as number | null, playingEvents: 0, stopEvents: 0, unexpectedStops: 0}));
  const byElement = new Map(rows.map((row) => [row.window.elementId, row] as const));
  let armed = false;
  return {
    arm() {armed = true;},
    observe(elementId: string, event: string, frame: number, sourceDuration: number) {
      if (!armed || !Number.isSafeInteger(frame) || frame < 0) return;
      const row = byElement.get(elementId); if (!row) return;
      if (Number.isFinite(sourceDuration) && sourceDuration > 0) row.sourceDurationSeconds = sourceDuration;
      if (event === "playing") {
        row.playingEvents++;
        if (row.firstPlayingFrame === null) row.firstPlayingFrame = frame;
        // A second playing after stopping is an interruption, never hidden by the final boundary.
        else if (row.stopFrame !== null) row.unexpectedStops++;
      }
      if ((event === "pause" || event === "ended") && row.firstPlayingFrame !== null) {
        row.stopEvents++; if (row.stopFrame === null) row.stopFrame = frame;
      }
    },
    snapshot() {return rows.map((row) => ({...row, window: {...row.window}}));},
  };
}

export function evaluateMediaBoundaries(input: unknown, originFrame: number, sampleRate: number, quantumMilliseconds: number,
  toleranceMilliseconds: number, expectedClipCount: number) {
  const report = {policy: MEDIA_BOUNDARY_POLICY, status: "PASS" as "PASS" | "FAIL" | "INCOMPLETE",
    checkedClipCount: 0, expectedClipCount, maximumBoundaryErrorUpperBoundMilliseconds: 0,
    failures: [] as Array<{clipId?: string; reason: string}>};
  const failure = (reason: string, status: "FAIL" | "INCOMPLETE", clipId?: string) => {
    if (report.status !== "FAIL") report.status = status;
    if (report.failures.length < 8) report.failures.push({reason, ...(clipId ? {clipId} : {})});
  };
  if (!Number.isSafeInteger(originFrame) || originFrame < 0 || !Number.isSafeInteger(sampleRate) || sampleRate <= 0
    || !Number.isFinite(quantumMilliseconds) || quantumMilliseconds <= 0
    || !Number.isFinite(toleranceMilliseconds) || toleranceMilliseconds <= 0
    || !Number.isSafeInteger(expectedClipCount) || expectedClipCount < 0 || expectedClipCount > 64) {
    failure("BOUNDARY_MEASUREMENT_INVALID", "FAIL"); return report;
  }
  if (!input) {failure("BOUNDARY_WITNESS_MISSING", "INCOMPLETE"); return report;}
  const witness = mediaBoundaryWitnessSchema.parse(input);
  if (witness.media.length !== expectedClipCount
    || mediaBoundaryPlanHash(witness.media.map((entry) => entry.window)) !== witness.planHash) {
    failure("BOUNDARY_PLAN_MISMATCH", "FAIL"); return report;
  }
  for (const row of witness.media) {
    const {window} = row;
    if (row.sourceDurationSeconds === null || row.sourceDurationSeconds <= 0 || row.firstPlayingFrame === null || row.stopFrame === null
      || row.playingEvents === 0 || row.stopEvents === 0) {failure("MEDIA_BOUNDARY_EVENTS_MISSING", "INCOMPLETE", window.clipId); continue;}
    if (row.unexpectedStops || row.stopFrame < row.firstPlayingFrame) {failure("MEDIA_PLAYBACK_INTERRUPTED", "FAIL", window.clipId); continue;}
    // AUDIO exhausts its source; the separate video audio loops. Use observed decoder duration, not metadata guessing.
    const end = window.loop ? window.endSeconds : Math.min(window.endSeconds,
      window.startSeconds + Math.max(0, row.sourceDurationSeconds - window.sourceOffsetSeconds));
    if (end <= window.startSeconds) {failure("MEDIA_SOURCE_EXHAUSTED", "INCOMPLETE", window.clipId); continue;}
    const onsetError = Math.abs((row.firstPlayingFrame - originFrame) * 1000 / sampleRate - window.startSeconds * 1000);
    const endError = Math.abs((row.stopFrame - originFrame) * 1000 / sampleRate - end * 1000);
    const error = Math.max(onsetError, endError); report.checkedClipCount++;
    report.maximumBoundaryErrorUpperBoundMilliseconds = Math.max(report.maximumBoundaryErrorUpperBoundMilliseconds, error + quantumMilliseconds);
    if (error - quantumMilliseconds > toleranceMilliseconds) failure("MEDIA_BOUNDARY_OUTSIDE_TOLERANCE", "FAIL", window.clipId);
    else if (error + quantumMilliseconds > toleranceMilliseconds) failure("MEDIA_BOUNDARY_UNCERTAINTY", "INCOMPLETE", window.clipId);
  }
  return report;
}

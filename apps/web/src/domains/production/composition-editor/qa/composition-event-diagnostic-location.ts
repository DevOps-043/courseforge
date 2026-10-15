import { createHash } from "node:crypto";
import { z } from "zod";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";
import { buildCompositionTransitionRuntime } from "../composition-transition-runtime";
import { COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS } from "../composition-conformance-batch-contract";
import { COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS } from "../composition-document.types.constants";

export const EVENT_DIAGNOSTIC_MAX_CLIP_REFERENCES = 16;
const DIAGNOSTIC_TIME_DECIMAL_PLACES = 6;
const DIAGNOSTIC_TIME_ROUNDING_TOLERANCE_SECONDS = 10 ** -DIAGNOSTIC_TIME_DECIMAL_PLACES;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const eventDiagnosticLocationSchema = z.object({
  scope: z.literal("ACTIVE_RUNTIME_CLIPS_NOT_FAILURE_CAUSALITY"),
  documentHash: hashSchema,
  frameIndex: z.number().int().nonnegative().max(COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS - 1),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
  timeSeconds: z.number().finite().nonnegative().max(COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS),
  activeClipSha256: z.array(hashSchema).max(EVENT_DIAGNOSTIC_MAX_CLIP_REFERENCES),
  omittedClipCount: z.number().int().nonnegative().max(500),
}).strict().superRefine((location, context) => {
  if (Math.abs(location.timeSeconds - location.frameIndex / location.fps) > DIAGNOSTIC_TIME_ROUNDING_TOLERANCE_SECONDS
    || new Set(location.activeClipSha256).size !== location.activeClipSha256.length
    || location.omittedClipCount > 0 && location.activeClipSha256.length !== EVENT_DIAGNOSTIC_MAX_CLIP_REFERENCES)
    context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_DIAGNOSTIC_LOCATION_INVALID"});
});

/** Hashes identifiers, never persists names, caption text, source paths or signed URLs. */
export const eventDiagnosticClipHash = (clipId: string) => createHash("sha256").update(clipId, "utf8").digest("hex");

/** Snapshot once before adapters run; transition handles use the same windows as the renderer. */
export function prepareEventDiagnosticLocations(input: CompositionEditorDocument) {
  const document = compositionEditorDocumentSchema.parse(input);
  const documentHash = hashCompositionDocument(document);
  const runtime = buildCompositionTransitionRuntime(document);
  const windows = document.clips.map((clip) => {
    const window = runtime.clipWindowsById.get(clip.id);
    return {hash: eventDiagnosticClipHash(clip.id), start: window?.startSeconds ?? clip.startSeconds,
      end: window?.endSeconds ?? clip.startSeconds + clip.durationSeconds};
  });
  const fps = document.canvas.fps, frameCount = Math.ceil(document.canvas.durationSeconds * fps);
  return (frameIndex: number) => {
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= frameCount)
      throw new Error("CONFORMANCE_EVENT_DIAGNOSTIC_FRAME_INVALID");
    const timeSeconds = frameIndex / fps;
    const active = windows.filter((window) => timeSeconds >= window.start && timeSeconds < window.end).map((window) => window.hash);
    return eventDiagnosticLocationSchema.parse({scope: "ACTIVE_RUNTIME_CLIPS_NOT_FAILURE_CAUSALITY", documentHash,
      frameIndex, fps, timeSeconds: Number(timeSeconds.toFixed(DIAGNOSTIC_TIME_DECIMAL_PLACES)),
      activeClipSha256: active.slice(0, EVENT_DIAGNOSTIC_MAX_CLIP_REFERENCES),
      omittedClipCount: Math.max(0, active.length - EVENT_DIAGNOSTIC_MAX_CLIP_REFERENCES)});
  };
}

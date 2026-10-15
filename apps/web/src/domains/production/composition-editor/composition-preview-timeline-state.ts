import { z } from "zod";
import type { CompositionEditorDocument } from "./composition-document.types";
import { captionCueElementId, captionWordElementId } from "./composition-native-overlay-renderer.service";
import { buildCompositionMotionRuntime, compositionMotionRuntimeSchema } from "./composition-motion-runtime";
import { buildCompositionPlaybackVolumeAutomations } from "./composition-playback-audio-envelope";
import { buildCompositionTransitionRuntime } from "./composition-transition-runtime";
import { COMPOSITION_TRANSITION_DIRECTIONS, COMPOSITION_TRANSITION_EASES, COMPOSITION_TRANSITION_TYPES } from "./composition-transition.types";

const id = z.string().min(1).max(300);
const seconds = z.number().finite().min(0).max(86_400);
const opacity = z.number().finite().min(0).max(1);
const word = z.object({ elementId: id, end: seconds, start: seconds }).strict();

export const compositionPreviewTimelineStateSchema = z.object({
  clips: z.array(z.object({
    captionCues: z.array(word.extend({ words: z.array(word).max(10_000) })).max(10_000),
    duration: seconds,
    hfId: id,
    hidden: z.boolean(),
    id,
    kind: z.enum(["AUDIO", "CAPTION", "DECK_SLIDE", "IMAGE", "TEXT", "VIDEO"]),
    layoutOpacity: opacity,
    layoutRotation: z.number().finite().min(-360).max(360),
    runtimeDuration: seconds,
    runtimeStart: seconds,
    start: seconds,
  }).strict()).max(500),
  motionAnimations: compositionMotionRuntimeSchema,
  transitionEffects: z.array(z.object({
    audioMode: z.enum(["CUT", "CROSSFADE"]),
    blurPixels: z.number().finite().min(0).max(40).optional(),
    direction: z.enum(COMPOSITION_TRANSITION_DIRECTIONS).optional(),
    durationSeconds: seconds,
    easing: z.enum(COMPOSITION_TRANSITION_EASES),
    endSeconds: seconds,
    fromAudioTargetId: id.optional(),
    fromAudioVolume: opacity.optional(),
    fromClipId: id,
    fromOpacity: opacity,
    id,
    overlayColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    overlayId: id.optional(),
    startSeconds: seconds,
    toAudioTargetId: id.optional(),
    toAudioVolume: opacity.optional(),
    toClipId: id,
    toOpacity: opacity,
    type: z.enum(COMPOSITION_TRANSITION_TYPES),
  }).strict()).max(499),
  volumeAutomations: z.array(z.object({
    baselineVolume: opacity,
    points: z.array(z.object({ timeSeconds: seconds, volume: opacity }).strict()).max(100_000),
    targetClipId: id,
  }).strict()).max(500),
}).strict();

export type CompositionPreviewTimelineState = z.infer<typeof compositionPreviewTimelineStateSchema>;

/** One projection for initial compilation, live updates and exported renders. */
export function buildCompositionPreviewTimelineState(
  document: CompositionEditorDocument,
  runtime = buildCompositionTransitionRuntime(document),
): CompositionPreviewTimelineState {
  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  return {
    clips: document.clips.map((clip) => {
      const window = runtime.clipWindowsById.get(clip.id);
      return {
        captionCues: clip.source.type === "NATIVE_CAPTIONS" ? clip.source.cues.map((cue) => ({
          elementId: captionCueElementId(clip.id, cue.id),
          end: clip.startSeconds + cue.endSeconds,
          start: clip.startSeconds + cue.startSeconds,
          words: (cue.words || []).map((word) => ({
            elementId: captionWordElementId(clip.id, cue.id, word.id),
            end: clip.startSeconds + word.endSeconds,
            start: clip.startSeconds + word.startSeconds,
          })),
        })) : [],
        duration: clip.durationSeconds,
        hfId: clip.hfId,
        hidden: clip.hidden || Boolean(tracksById.get(clip.trackId)?.hidden),
        id: clip.id,
        kind: clip.kind,
        layoutOpacity: clip.layout.opacity,
        layoutRotation: clip.layout.rotation,
        runtimeDuration: window?.durationSeconds ?? clip.durationSeconds,
        runtimeStart: window?.startSeconds ?? clip.startSeconds,
        start: clip.startSeconds,
      };
    }),
    motionAnimations: buildCompositionMotionRuntime(document),
    transitionEffects: runtime.items,
    volumeAutomations: buildCompositionPlaybackVolumeAutomations(document, runtime),
  };
}

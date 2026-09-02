import { z } from "zod";
import type { CompositionEditorDocument } from "./composition-document.types";
import { compositionMotionKeyframeSchema, compositionMotionLoopSchema } from "./composition-motion.types";
import { resolveCompositionAnimationWindow } from "./composition-motion-scheduling.service";

export const compositionMotionRuntimeSchema = z.array(z.object({
  duration: z.number().finite().positive().max(86_400),
  id: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i),
  keyframes: z.array(compositionMotionKeyframeSchema).min(2).max(50),
  loop: compositionMotionLoopSchema.optional(),
  start: z.number().finite().min(0).max(86_400),
  targetId: z.string().regex(/^[a-z][a-z0-9-]{0,134}$/i),
}).strict()).max(200);

/** Shared by the canonical renderer and live edits to prevent motion drift. */
export function buildCompositionMotionRuntime(document: CompositionEditorDocument) {
  return document.motion.animations.map((animation) => {
    const clip = document.clips.find((candidate) => candidate.id === animation.target.clipId)!;
    return {
      duration: animation.timing.durationSeconds, id: animation.id,
      keyframes: animation.keyframes, loop: animation.loop,
      start: clip.startSeconds + resolveCompositionAnimationWindow(animation, clip.durationSeconds).start,
      targetId: `${clip.id}-motion`,
    };
  });
}

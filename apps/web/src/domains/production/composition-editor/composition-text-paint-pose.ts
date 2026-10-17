import { z } from "zod";
import { parseTextPaintInset, projectTextPaintGeometry } from "./composition-text-paint-geometry";

const finite = z.number().finite();
const matrix = z.tuple([finite, finite, finite, finite, finite, finite]);
export const nativeTextPaintPoseSchema = z.object({
  clipId: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i),
  left: finite, top: finite, width: finite.positive(), height: finite.positive(),
  parentMatrix: matrix, motionMatrix: matrix,
  inset: z.tuple([finite.min(0).max(1), finite.min(0).max(1), finite.min(0).max(1), finite.min(0).max(1)]),
  filter: z.string().regex(/^blur\((?:\d+(?:\.\d+)?|\.\d+)px\)$/),
  support: z.object({empty: z.boolean(), polygon: z.array(z.object({x: finite.nonnegative(), y: finite.nonnegative()}).strict()).max(12)}).strict()
    .refine((support) => support.empty ? support.polygon.length === 0 : support.polygon.length >= 3),
}).strict();
export type NativeTextPaintPose = z.infer<typeof nativeTextPaintPoseSchema>;

/** CSS transform matrices exclude transform-origin; the reader verifies origins separately. */
export function buildNativeTextPaintPose(clipId: string, input: Parameters<typeof projectTextPaintGeometry>[0], filter: string): NativeTextPaintPose {
  const {layout, motion, transition} = input;
  const parentAngle = layout.rotation * Math.PI / 180, subjectAngle = motion.rotation * Math.PI / 180;
  return nativeTextPaintPoseSchema.parse({clipId, left: layout.x, top: layout.y, width: layout.width, height: layout.height,
    parentMatrix: [Math.cos(parentAngle), Math.sin(parentAngle), -Math.sin(parentAngle), Math.cos(parentAngle),
      layout.width * transition.xPercent / 100, layout.height * transition.yPercent / 100],
    motionMatrix: [motion.scale * Math.cos(subjectAngle), motion.scale * Math.sin(subjectAngle),
      -motion.scale * Math.sin(subjectAngle), motion.scale * Math.cos(subjectAngle), motion.x, motion.y],
    inset: parseTextPaintInset(transition.clipPath), filter, support: projectTextPaintGeometry(input)});
}

/** Build-time rollout switch. Reading/rendering V2 remains enabled so rollback never loses motion data. */
export const COMPOSITION_MOTION_ENABLED = process.env.NEXT_PUBLIC_COMPOSITION_MOTION_ENABLED !== "false";

export function isCompositionMotionOperation(type: string) {
  return type.startsWith("animation.");
}

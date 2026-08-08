import type { SceneSpec } from "./types";

export function isFiniteFrame(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function normalizeScenes(scenes: SceneSpec[] | undefined, durationInFrames: number): SceneSpec[] {
  if (!Array.isArray(scenes) || scenes.length === 0) return [];
  const sorted = [...scenes].sort((left, right) => left.startFrame - right.startFrame);
  const ids = new Set<string>();
  let previousEnd = 0;

  for (const scene of sorted) {
    if (!scene.id || ids.has(scene.id) || !isFiniteFrame(scene.startFrame) || !isFiniteFrame(scene.endFrame)) return [];
    if (scene.startFrame >= scene.endFrame || scene.endFrame > durationInFrames || scene.startFrame < previousEnd) return [];
    ids.add(scene.id);
    previousEnd = scene.endFrame;
  }

  return sorted;
}

export function getActiveScene(frame: number, scenes: SceneSpec[]) {
  return scenes.find((scene) => frame >= scene.startFrame && frame < scene.endFrame) ?? null;
}

export function getSceneOpacity(frame: number, scene: SceneSpec) {
  const duration = scene.endFrame - scene.startFrame;
  const fadeIn = scene.transitionIn?.type === "fade" ? Math.min(scene.transitionIn.durationFrames ?? 10, Math.floor(duration / 2)) : 0;
  const fadeOut = scene.transitionOut?.type === "fade" ? Math.min(scene.transitionOut.durationFrames ?? 10, Math.floor(duration / 2)) : 0;
  const localFrame = frame - scene.startFrame;
  const entering = fadeIn > 0 ? Math.min(1, Math.max(0, localFrame / fadeIn)) : 1;
  const leaving = fadeOut > 0 ? Math.min(1, Math.max(0, (scene.endFrame - frame) / fadeOut)) : 1;
  return Math.min(entering, leaving);
}

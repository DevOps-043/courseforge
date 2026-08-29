import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssemblyAssets } from "../assembly-assets.normalizer";
import { createDefaultAssemblyProps } from "../types";
import { buildVisualTimeline } from "../visual-timeline";

test("preserves voice-only gaps between generated avatar scenes", () => {
  const avatarClips = [1, 2, 3, 4, 5, 6].map((order) => ({
    id: `scene-${order}`,
    order,
    script_text: `Escena ${order}`,
    status: ([1, 3, 5].includes(order) ? "COMPLETED" : "DRAFT") as "COMPLETED" | "DRAFT",
    ...([1, 3, 5].includes(order) ? {
      duration: 4,
      public_url: `https://cdn.example.test/avatar-${order}.mp4`,
      storage_path: `production-assets/avatar-${order}.mp4`,
    } : {}),
  }));
  const voiceClips = avatarClips.map((scene) => ({
    clip_id: scene.id,
    duration: 4,
    id: `voice-${scene.id}`,
    order: scene.order,
    public_url: `https://cdn.example.test/voice-${scene.order}.mp3`,
    script_hash: "hash",
    status: "COMPLETED" as const,
    storage_path: `production-assets/voice-${scene.order}.mp3`,
  }));
  const normalized = normalizeAssemblyAssets({
    avatar_clips: avatarClips,
    avatar_generation_mode: "scene_clips",
    voice_clips: voiceClips,
  }, 30);

  assert.deepEqual(normalized.voiceClips.map((clip) => clip.startInFrames), [0, 120, 240, 360, 480, 600]);
  assert.deepEqual(normalized.avatarClips.map((clip) => clip.startInFrames), [0, 240, 480]);
  assert.equal(normalized.totalDurationSeconds, 24);

  const timeline = buildVisualTimeline({
    ...createDefaultAssemblyProps(),
    ...normalized,
    totalDurationInFrames: 720,
  });
  const avatarSegments = timeline.tracks.find((track) => track.kind === "avatar")?.segments || [];
  const voiceSegments = timeline.tracks.find((track) => track.kind === "audio")?.segments
    .filter((segment) => segment.id.startsWith("voice-")) || [];

  assert.deepEqual(avatarSegments.map((segment) => segment.startFrame), [0, 240, 480]);
  assert.deepEqual(voiceSegments.map((segment) => segment.startFrame), [0, 120, 240, 360, 480, 600]);
});

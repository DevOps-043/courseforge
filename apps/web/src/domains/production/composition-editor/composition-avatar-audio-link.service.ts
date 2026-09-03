import type { CompositionClip, CompositionEditorDocument } from "./composition-document.types";

type AvatarAudioPair = {
  avatar: CompositionClip;
  voice: CompositionClip;
};

/**
 * Resolves only the generated voice/avatar pair for a single narrative scene.
 * A shared scene id is the durable production contract; matching by track order,
 * filename, duration, or proximity would incorrectly couple independent media.
 */
export function resolveAvatarAudioPair(
  document: CompositionEditorDocument,
  clipId: string,
): AvatarAudioPair | null {
  const selected = document.clips.find((clip) => clip.id === clipId);
  if (!selected?.sceneId) return null;

  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  const sceneClips = document.clips.filter((clip) => clip.sceneId === selected.sceneId);
  const avatar = sceneClips.find((clip) => tracksById.get(clip.trackId)?.semanticRole === "AVATAR");
  const voice = sceneClips.find((clip) => (
    clip.kind === "AUDIO" && tracksById.get(clip.trackId)?.semanticRole === "VOICE"
  ));

  return avatar && voice ? { avatar, voice } : null;
}

/** Returns the counterpart only when the selected clip belongs to an avatar/voice pair. */
export function resolveLinkedAvatarAudioClip(
  document: CompositionEditorDocument,
  clipId: string,
): CompositionClip | null {
  const pair = resolveAvatarAudioPair(document, clipId);
  if (!pair) return null;
  if (pair.avatar.id === clipId) return pair.voice;
  if (pair.voice.id === clipId) return pair.avatar;
  return null;
}

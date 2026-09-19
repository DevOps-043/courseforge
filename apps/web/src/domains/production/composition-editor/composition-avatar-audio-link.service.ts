import type { CompositionClip, CompositionEditorDocument } from "./composition-document.types";

export type AvatarAudioPair = {
  avatar: CompositionClip;
  voice: CompositionClip;
};

export type AvatarAudioLinkResolution =
  | { status: "NONE" }
  | { avatarIds: string[]; sceneId: string; status: "AMBIGUOUS"; voiceIds: string[] }
  | ({ sceneId: string; status: "LINKED" } & AvatarAudioPair);

/**
 * Resolves the system-owned temporal link without guessing by proximity,
 * filename or duration. Ambiguous scene membership is reported explicitly so
 * timeline operations can fail closed instead of moving an arbitrary fragment.
 */
export function resolveAvatarAudioLink(
  document: CompositionEditorDocument,
  clipId: string,
): AvatarAudioLinkResolution {
  const selected = document.clips.find((clip) => clip.id === clipId);
  if (!selected?.sceneId) return { status: "NONE" };

  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  const selectedRole = tracksById.get(selected.trackId)?.semanticRole;
  if (selectedRole !== "AVATAR" && !(selectedRole === "VOICE" && selected.kind === "AUDIO")) {
    return { status: "NONE" };
  }

  const sceneClips = document.clips.filter((clip) => clip.sceneId === selected.sceneId);
  const avatars = sceneClips.filter((clip) => tracksById.get(clip.trackId)?.semanticRole === "AVATAR");
  const voices = sceneClips.filter((clip) => (
    clip.kind === "AUDIO" && tracksById.get(clip.trackId)?.semanticRole === "VOICE"
  ));

  if (avatars.length > 1 || voices.length > 1) {
    return {
      avatarIds: avatars.map((clip) => clip.id),
      sceneId: selected.sceneId,
      status: "AMBIGUOUS",
      voiceIds: voices.map((clip) => clip.id),
    };
  }
  if (avatars.length !== 1 || voices.length !== 1) return { status: "NONE" };
  return {
    avatar: avatars[0]!,
    sceneId: selected.sceneId,
    status: "LINKED",
    voice: voices[0]!,
  };
}

/**
 * Resolves only the generated voice/avatar pair for a single narrative scene.
 * A shared scene id is the durable production contract; matching by track order,
 * filename, duration, or proximity would incorrectly couple independent media.
 */
export function resolveAvatarAudioPair(
  document: CompositionEditorDocument,
  clipId: string,
): AvatarAudioPair | null {
  const resolution = resolveAvatarAudioLink(document, clipId);
  return resolution.status === "LINKED"
    ? { avatar: resolution.avatar, voice: resolution.voice }
    : null;
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

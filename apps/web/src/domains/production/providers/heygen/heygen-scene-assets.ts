import type {
  AvatarClip,
  VoiceClip,
} from "@/domains/materials/types/materials.types";

/**
 * Clears generated projections while retaining the authored scene. Incrementing
 * generation_revision makes the next provider request intentionally distinct.
 */
export function resetGeneratedSceneAssets(params: {
  avatarClips: AvatarClip[];
  clipIds: string[];
  voiceClips: VoiceClip[];
}) {
  const selectedIds = new Set(params.clipIds);
  const avatarClips = params.avatarClips.map((clip) => {
    if (!selectedIds.has(clip.id)) return clip;

    const {
      duration: _duration,
      error_message: _errorMessage,
      external_id: _externalId,
      file_name: _fileName,
      has_audio: _hasAudio,
      job_id: _jobId,
      provider: _provider,
      public_url: _publicUrl,
      script_hash: _scriptHash,
      storage_path: _storagePath,
      voice_error_message: _voiceErrorMessage,
      voice_status: _voiceStatus,
      ...editableScene
    } = clip;

    return {
      ...editableScene,
      generation_revision: (clip.generation_revision ?? 0) + 1,
      status: "DRAFT" as const,
      voice_status: "DRAFT" as const,
    };
  }).sort((left, right) => left.order - right.order);

  return {
    avatarClips,
    voiceClips: params.voiceClips.filter((clip) => !selectedIds.has(clip.clip_id)),
  };
}

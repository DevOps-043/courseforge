interface PresetOption {
  id: string;
  is_default?: boolean;
}

interface PresetSelection {
  avatarPresetId?: string | null;
  voicePresetId?: string | null;
}

/** El enlace transmite preferencias; el catálogo autorizado decide cuáles existen. */
export function resolveHeygenInitialPresetId(
  presets: readonly PresetOption[],
  preferredId?: string | null,
): string {
  return presets.find((preset) => preset.id === preferredId)?.id
    || presets.find((preset) => preset.is_default)?.id
    || presets[0]?.id
    || "";
}

export function buildHeygenCourseQuery(
  context: PresetSelection & { componentId: string; returnTo: string },
): URLSearchParams {
  const query = new URLSearchParams({
    componentId: context.componentId,
    returnTo: context.returnTo,
    source: "course",
  });
  if (context.avatarPresetId) query.set("avatarPresetId", context.avatarPresetId);
  if (context.voicePresetId) query.set("voicePresetId", context.voicePresetId);
  return query;
}

/** Materializa el fallback visible antes de persistir, sin alterar ajustes propios. */
export function resolveHeygenScenePresets<T extends {
  avatar_preset_id?: string;
  voice_preset_id?: string;
}>(clips: readonly T[], selection: PresetSelection): T[] {
  return clips.map((clip) => ({
    ...clip,
    avatar_preset_id: clip.avatar_preset_id || selection.avatarPresetId || undefined,
    voice_preset_id: clip.voice_preset_id || selection.voicePresetId || undefined,
  }));
}

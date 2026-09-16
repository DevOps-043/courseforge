import type {
  CompositionEditorDocument,
  CompositionTrack,
  CompositionTrackRole,
} from "./composition-document.types";
export type ProductionTimelineRole = "AUDIO" | "AVATAR" | "BROLL" | "VISUAL" | "VOICE";

const TRACK_DEFINITIONS: Record<CompositionTrackRole, CompositionTrack> = {
  DECK: { hidden: false, id: "deck", kind: "DECK", label: "Diapositivas", locked: false, muted: false, order: 0, semanticRole: "DECK", volume: 1 },
  AVATAR: { hidden: false, id: "avatar", kind: "VISUAL", label: "Avatar", locked: false, muted: false, order: 10, semanticRole: "AVATAR", volume: 1 },
  VOICE: { hidden: false, id: "voice", kind: "AUDIO", label: "Voz / narración", locked: false, muted: false, order: 20, semanticRole: "VOICE", volume: 1 },
  MUSIC: { hidden: false, id: "music", kind: "AUDIO", label: "Música", locked: false, muted: false, order: 30, semanticRole: "MUSIC", volume: 0.25 },
  SFX: { hidden: false, id: "sfx", kind: "AUDIO", label: "Efectos de sonido", locked: false, muted: false, order: 35, semanticRole: "SFX", volume: 0.7 },
  BROLL: { hidden: false, id: "broll", kind: "VISUAL", label: "B-roll", locked: false, muted: false, order: 40, semanticRole: "BROLL", volume: 1 },
  VISUAL: { hidden: false, id: "visual", kind: "VISUAL", label: "Medios visuales", locked: false, muted: false, order: 50, semanticRole: "VISUAL", volume: 1 },
  OVERLAY: { hidden: false, id: "overlay", kind: "OVERLAY", label: "Gráficos y overlays", locked: false, muted: false, order: 60, semanticRole: "OVERLAY", volume: 1 },
};

export function getCompositionTrackDefinition(role: CompositionTrackRole): CompositionTrack {
  return { ...TRACK_DEFINITIONS[role] };
}

export function resolveCompositionTrackRole(input: { mimeType: string; timelineRole?: ProductionTimelineRole }): CompositionTrackRole {
  if (input.timelineRole === "VOICE") return "VOICE";
  if (input.timelineRole === "AUDIO" || input.mimeType.startsWith("audio/")) return "MUSIC";
  if (input.timelineRole === "AVATAR") return "AVATAR";
  if (input.timelineRole === "BROLL") return "BROLL";
  return "VISUAL";
}

export function resolveCompositionTrackDefinition(input: { mimeType: string; timelineRole?: ProductionTimelineRole }) {
  return getCompositionTrackDefinition(resolveCompositionTrackRole(input));
}

/** Upgrades legacy generic tracks in memory while preserving unknown authored tracks. */
export function normalizeCompositionTrackTopology(
  document: CompositionEditorDocument,
  assetRoles: ReadonlyMap<string, string>,
): CompositionEditorDocument {
  const legacyTracks = new Map(document.tracks.map((track) => [track.id, track]));
  const normalizedClips = document.clips.map((clip) => {
    if (clip.source.type === "DECK_SLIDE") return { ...clip, trackId: TRACK_DEFINITIONS.DECK.id };
    if (clip.source.type === "ASSEMBLY_BRAND_ASSET") return clip;
    if (clip.source.type === "SOUND_EFFECT_ASSET") return { ...clip, trackId: TRACK_DEFINITIONS.SFX.id };
    const storedRole = normalizeProductionTimelineRole(assetRoles.get(clip.source.productionAssetId));
    const role = storedRole
      ? resolveCompositionTrackRole({ mimeType: clip.kind === "AUDIO" ? "audio/unknown" : "application/octet-stream", timelineRole: storedRole })
      : inferLegacyTrackRole(clip.trackId, clip.kind);
    return role ? { ...clip, trackId: TRACK_DEFINITIONS[role].id } : clip;
  });
  const usedTrackIds = new Set(normalizedClips.map((clip) => clip.trackId));
  const canonicalTracks = Object.values(TRACK_DEFINITIONS)
    .filter((track) => usedTrackIds.has(track.id))
    .map((definition) => {
      const stored = legacyTracks.get(definition.id)
        || ((definition.id === "voice" || definition.id === "music") ? legacyTracks.get("audio") : undefined);
      return stored ? {
        ...definition,
        hidden: stored.hidden ?? definition.hidden,
        locked: stored.locked,
        muted: stored.muted ?? definition.muted,
        volume: stored.volume ?? definition.volume,
      } : { ...definition };
    });
  const customTracks = [...usedTrackIds]
    .filter((trackId) => !canonicalTracks.some((track) => track.id === trackId))
    .map((trackId) => legacyTracks.get(trackId))
    .filter((track): track is CompositionTrack => Boolean(track));
  return {
    ...document,
    clips: normalizedClips,
    tracks: [...canonicalTracks, ...customTracks].sort((left, right) => left.order - right.order),
  };
}

function normalizeProductionTimelineRole(value: string | undefined): ProductionTimelineRole | undefined {
  return value === "AUDIO" || value === "AVATAR" || value === "BROLL" || value === "VISUAL" || value === "VOICE"
    ? value
    : undefined;
}

function inferLegacyTrackRole(trackId: string, kind: CompositionEditorDocument["clips"][number]["kind"]): CompositionTrackRole | undefined {
  if (trackId === "deck") return "DECK";
  if (trackId === "avatar") return "AVATAR";
  if (trackId === "voice") return "VOICE";
  if (trackId === "music" || trackId === "audio") return kind === "AUDIO" ? "MUSIC" : undefined;
  if (trackId === "sfx") return kind === "AUDIO" ? "SFX" : undefined;
  if (trackId === "broll") return "BROLL";
  if (trackId === "visual") return "VISUAL";
  if (trackId === "overlay") return "OVERLAY";
  return undefined;
}

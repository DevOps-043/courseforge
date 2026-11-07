import { COMPOSITION_TRACK_ROLES, type CompositionEditorDocument, type CompositionTrack, type CompositionTrackRole } from "./composition-document.types";

export function resolveCompositionPresetRole(track: CompositionTrack): CompositionTrackRole | null {
  if (track.semanticRole) return track.semanticRole;
  return COMPOSITION_TRACK_ROLES.find(role => role === track.id.toUpperCase()) ?? null;
}

export function selectCompositionPresetTracks(document: CompositionEditorDocument, role: CompositionTrackRole) {
  return document.tracks.filter(track => resolveCompositionPresetRole(track) === role)
    .sort((left, right) => left.order - right.order);
}

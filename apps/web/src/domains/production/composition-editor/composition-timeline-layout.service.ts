import type {
  CompositionClip,
  CompositionEditorDocument,
  CompositionTrack,
} from "./composition-document.types";
import { compositionClipHasConfigurableAudio } from "./composition-clip-audio.service";
import { buildCompositionTransitionRuntime } from "./composition-transition-runtime";

export interface CompositionTimelineLane {
  clips: CompositionClip[];
  id: string;
}

export interface CompositionTimelineDisplayGroup {
  clips: CompositionClip[];
  id: string;
  kind: "AUDIO" | "VISUAL";
  lanes: CompositionTimelineLane[];
  track: CompositionTrack;
  zIndex?: number;
}

export interface CompositionTimelineLayout {
  audioTrackIndexByClipId: ReadonlyMap<string, number>;
  groups: CompositionTimelineDisplayGroup[];
  trackIndexByClipId: ReadonlyMap<string, number>;
}

/**
 * Builds the single deterministic projection shared by the editor and the
 * HyperFrames compiler. Visual groups follow paint depth; clips only share a
 * temporal lane when their half-open intervals do not overlap.
 */
export function buildCompositionTimelineLayout(
  document: CompositionEditorDocument,
): CompositionTimelineLayout {
  const transitionRuntime = buildCompositionTransitionRuntime(document);
  const clipsByTrack = groupClipsByTrack(document.clips);
  const visualGroups: CompositionTimelineDisplayGroup[] = [];
  const audioGroups: CompositionTimelineDisplayGroup[] = [];

  for (const track of document.tracks.slice().sort(compareTracks)) {
    const clips = clipsByTrack.get(track.id) ?? [];
    if (track.kind === "AUDIO") {
      if (clips.length > 0) audioGroups.push(buildGroup(track, clips, "AUDIO"));
      continue;
    }

    const clipsByDepth = new Map<number, CompositionClip[]>();
    for (const clip of clips) {
      const depthClips = clipsByDepth.get(clip.layout.zIndex) ?? [];
      depthClips.push(clip);
      clipsByDepth.set(clip.layout.zIndex, depthClips);
    }
    for (const [zIndex, depthClips] of [...clipsByDepth.entries()].sort(([left], [right]) => right - left)) {
      visualGroups.push(buildGroup(
        track,
        depthClips,
        "VISUAL",
        zIndex,
        (clip) => transitionRuntime.clipWindowsById.get(clip.id),
      ));
    }
  }

  visualGroups.sort((left, right) => (
    (right.zIndex ?? 0) - (left.zIndex ?? 0)
    || compareTracks(left.track, right.track)
    || left.id.localeCompare(right.id)
  ));

  const groups = [...visualGroups, ...audioGroups];
  const trackIndexByClipId = new Map<string, number>();
  let nextTrackIndex = 0;
  for (const group of groups) {
    for (const lane of group.lanes) {
      for (const clip of lane.clips) trackIndexByClipId.set(clip.id, nextTrackIndex);
      nextTrackIndex += 1;
    }
  }

  // HyperFrames requires video sound to live on a separate <audio> element.
  // Pack those elements independently after the visible/audio clip lanes.
  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  const synchronizedVideoClips = document.clips.filter((clip) => (
    clip.kind === "VIDEO" && compositionClipHasConfigurableAudio(clip, tracksById.get(clip.trackId))
  ));
  const audioTrackIndexByClipId = new Map<string, number>();
  for (const lane of packTimelineClips(
    synchronizedVideoClips,
    "synchronized-audio",
    (clip) => transitionRuntime.audioWindowsByClipId.get(clip.id),
  )) {
    for (const clip of lane.clips) audioTrackIndexByClipId.set(clip.id, nextTrackIndex);
    nextTrackIndex += 1;
  }

  return { audioTrackIndexByClipId, groups, trackIndexByClipId };
}

export function packTimelineClips(
  clips: readonly CompositionClip[],
  laneIdPrefix: string,
  resolveWindow: (clip: CompositionClip) => { endSeconds: number; startSeconds: number } | undefined
    = (clip) => ({ endSeconds: clip.startSeconds + clip.durationSeconds, startSeconds: clip.startSeconds }),
): CompositionTimelineLane[] {
  const lanes: Array<CompositionTimelineLane & { endSeconds: number }> = [];
  const sorted = clips.slice().sort(compareClips);

  for (const clip of sorted) {
    const window = resolveWindow(clip)
      || { endSeconds: clip.startSeconds + clip.durationSeconds, startSeconds: clip.startSeconds };
    const available = lanes
      .filter((lane) => lane.endSeconds <= window.startSeconds)
      .sort((left, right) => left.endSeconds - right.endSeconds || left.id.localeCompare(right.id))[0];
    if (available) {
      available.clips.push(clip);
      available.endSeconds = window.endSeconds;
      continue;
    }
    lanes.push({
      clips: [clip],
      endSeconds: window.endSeconds,
      id: `${laneIdPrefix}:lane-${lanes.length}`,
    });
  }

  return lanes.map(({ clips: laneClips, id }) => ({ clips: laneClips, id }));
}

function buildGroup(
  track: CompositionTrack,
  clips: CompositionClip[],
  kind: CompositionTimelineDisplayGroup["kind"],
  zIndex?: number,
  resolveWindow?: (clip: CompositionClip) => { endSeconds: number; startSeconds: number } | undefined,
): CompositionTimelineDisplayGroup {
  const id = zIndex === undefined ? `audio:${track.id}` : `visual:${zIndex}:${track.id}`;
  return {
    clips: clips.slice().sort(compareClips),
    id,
    kind,
    lanes: packTimelineClips(clips, id, resolveWindow),
    track,
    ...(zIndex === undefined ? {} : { zIndex }),
  };
}

function groupClipsByTrack(clips: readonly CompositionClip[]) {
  const grouped = new Map<string, CompositionClip[]>();
  for (const clip of clips) {
    const trackClips = grouped.get(clip.trackId) ?? [];
    trackClips.push(clip);
    grouped.set(clip.trackId, trackClips);
  }
  return grouped;
}

function compareTracks(left: CompositionTrack, right: CompositionTrack) {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function compareClips(left: CompositionClip, right: CompositionClip) {
  return left.startSeconds - right.startSeconds
    || left.durationSeconds - right.durationSeconds
    || left.id.localeCompare(right.id);
}

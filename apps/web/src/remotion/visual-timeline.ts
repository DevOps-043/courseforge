import {
  getBrollItemLayerId,
  getSlideItemLayerId,
  REMOTION_EDITABLE_LAYERS,
  type RemotionEditableLayerId,
} from "./layout-override-styles";
import type {
  AssemblyBrollClip,
  AssemblyInputProps,
  AssemblySlide,
} from "./types";

export interface BrollTimelineItem {
  clip: AssemblyBrollClip;
  startFrame: number;
  durationInFrames: number;
}

export function buildBrollTimeline(
  clips: AssemblyBrollClip[],
  totalDurationInFrames: number,
): BrollTimelineItem[] {
  if (clips.length === 0 || totalDurationInFrames <= 0) {
    return [];
  }

  const ordered = [...clips].sort((left, right) => left.order - right.order);
  const totalClipFrames = ordered.reduce(
    (sum, clip) => sum + clip.durationInFrames,
    0,
  );
  const availableGapFrames = Math.max(0, totalDurationInFrames - totalClipFrames);
  const gapFrames =
    availableGapFrames > 0
      ? Math.floor(availableGapFrames / (ordered.length + 1))
      : 0;

  const items: BrollTimelineItem[] = [];
  let cursor = gapFrames;

  for (const clip of ordered) {
    if (cursor >= totalDurationInFrames) {
      break;
    }

    const remainingFrames = totalDurationInFrames - cursor;
    const durationInFrames = Math.min(clip.durationInFrames, remainingFrames);

    if (durationInFrames > 0) {
      items.push({
        clip,
        startFrame: cursor,
        durationInFrames,
      });
    }

    cursor += durationInFrames + gapFrames;
  }

  return items;
}

export type VisualTimelineTrackKind =
  | "audio"
  | "avatar"
  | "slides"
  | "broll";

export interface VisualTimelineSegment {
  id: string;
  trackKind: VisualTimelineTrackKind;
  layerId?: RemotionEditableLayerId;
  label: string;
  detail?: string;
  startFrame: number;
  endFrame: number;
  durationInFrames: number;
  sourceUrl?: string;
}

export interface VisualTimelineTrack {
  id: string;
  kind: VisualTimelineTrackKind;
  label: string;
  segments: VisualTimelineSegment[];
}

export interface VisualTimeline {
  fps: number;
  durationInFrames: number;
  durationInSeconds: number;
  tracks: VisualTimelineTrack[];
}

const MAX_TRANSITION_FRAMES = 15;

function clampTimelineFrame(frame: number, durationInFrames: number): number {
  if (!Number.isFinite(frame)) {
    return 0;
  }

  return Math.min(durationInFrames, Math.max(0, Math.round(frame)));
}

function buildSegment(params: {
  id: string;
  trackKind: VisualTimelineTrackKind;
  layerId?: RemotionEditableLayerId;
  label: string;
  detail?: string;
  startFrame: number;
  durationInFrames: number;
  sourceUrl?: string;
  totalDurationInFrames: number;
}): VisualTimelineSegment | null {
  const startFrame = clampTimelineFrame(
    params.startFrame,
    params.totalDurationInFrames,
  );
  const requestedEndFrame = startFrame + Math.max(0, params.durationInFrames);
  const endFrame = clampTimelineFrame(
    requestedEndFrame,
    params.totalDurationInFrames,
  );
  const durationInFrames = endFrame - startFrame;

  if (durationInFrames <= 0) {
    return null;
  }

  return {
    id: params.id,
    trackKind: params.trackKind,
    layerId: params.layerId,
    label: params.label,
    detail: params.detail,
    startFrame,
    endFrame,
    durationInFrames,
    sourceUrl: params.sourceUrl,
  };
}

function buildSlideTimeline(
  slides: AssemblySlide[],
  totalDurationInFrames: number,
  transitionType: AssemblyInputProps["transitionType"],
  fps: number,
): VisualTimelineSegment[] {
  if (slides.length === 0 || totalDurationInFrames <= 0) {
    return [];
  }

  const ordered = [...slides].sort((left, right) => left.index - right.index);
  const slideCount = ordered.length;
  const perSlideFrames = Math.max(1, Math.floor(totalDurationInFrames / slideCount));
  const transitionFrames =
    transitionType === "none" || slideCount === 1
      ? 0
      : Math.min(MAX_TRANSITION_FRAMES, Math.max(1, Math.floor(perSlideFrames / 2)));

  return ordered.flatMap((slide, index) => {
    const startFrame = index * perSlideFrames;
    const durationInFrames =
      index < slideCount - 1
        ? perSlideFrames + transitionFrames
        : totalDurationInFrames - startFrame;
    const segment = buildSegment({
      id: `slide-${slide.index}`,
      trackKind: "slides",
      layerId: getSlideItemLayerId(slide.index),
      label: `Slide ${slide.index + 1}`,
      detail: transitionFrames > 0 && index < slideCount - 1
        ? `${Math.round((transitionFrames / fps) * 10) / 10}s transicion`
        : undefined,
      startFrame,
      durationInFrames,
      sourceUrl: slide.url,
      totalDurationInFrames,
    });

    return segment ? [segment] : [];
  });
}

function buildSequentialBrollTimeline(
  clips: AssemblyBrollClip[],
  totalDurationInFrames: number,
): BrollTimelineItem[] {
  const ordered = [...clips].sort((left, right) => left.order - right.order);
  const items: BrollTimelineItem[] = [];
  let cursor = 0;

  for (const clip of ordered) {
    const durationInFrames = Math.min(
      clip.durationInFrames,
      Math.max(0, totalDurationInFrames - cursor),
    );

    if (durationInFrames > 0) {
      items.push({ clip, startFrame: cursor, durationInFrames });
    }

    cursor += durationInFrames;
    if (cursor >= totalDurationInFrames) {
      break;
    }
  }

  return items;
}

function buildBrollSegments(props: AssemblyInputProps): VisualTimelineSegment[] {
  const rawTimeline =
    props.slides.length > 0
      ? buildBrollTimeline(props.brollClips, props.totalDurationInFrames)
      : buildSequentialBrollTimeline(
          props.brollClips,
          props.totalDurationInFrames,
        );

  return rawTimeline.flatMap((item) => {
    const segment = buildSegment({
      id: `broll-${item.clip.order}`,
      trackKind: "broll",
      layerId: getBrollItemLayerId(item.clip.order),
      label: `B-roll ${item.clip.order}`,
      startFrame: item.startFrame,
      durationInFrames: item.durationInFrames,
      sourceUrl: item.clip.url,
      totalDurationInFrames: props.totalDurationInFrames,
    });

    return segment ? [segment] : [];
  });
}

function buildFullDurationSegment(params: {
  id: string;
  trackKind: VisualTimelineTrackKind;
  layerId?: RemotionEditableLayerId;
  label: string;
  sourceUrl?: string;
  totalDurationInFrames: number;
}) {
  return buildSegment({
    ...params,
    startFrame: 0,
    durationInFrames: params.totalDurationInFrames,
  });
}

export function buildVisualTimeline(props: AssemblyInputProps): VisualTimeline {
  const tracks: VisualTimelineTrack[] = [];
  const audioSegments = [
    props.voiceAudioUrl
      ? buildFullDurationSegment({
          id: "voice",
          trackKind: "audio",
          label: "Voz",
          sourceUrl: props.voiceAudioUrl,
          totalDurationInFrames: props.totalDurationInFrames,
        })
      : null,
    props.bgMusicUrl
      ? buildFullDurationSegment({
          id: "music",
          trackKind: "audio",
          label: "Musica",
          sourceUrl: props.bgMusicUrl,
          totalDurationInFrames: props.totalDurationInFrames,
        })
      : null,
  ].filter((segment): segment is VisualTimelineSegment => Boolean(segment));

  if (audioSegments.length > 0) {
    tracks.push({
      id: "audio",
      kind: "audio",
      label: "Audio",
      segments: audioSegments,
    });
  }

  const avatarSegment = props.avatarVideoUrl
    ? buildFullDurationSegment({
        id: "avatar",
        trackKind: "avatar",
        layerId: REMOTION_EDITABLE_LAYERS.AVATAR,
        label: "Avatar",
        sourceUrl: props.avatarVideoUrl,
        totalDurationInFrames: props.totalDurationInFrames,
      })
    : null;

  if (avatarSegment) {
    tracks.push({
      id: "avatar",
      kind: "avatar",
      label: "Avatar",
      segments: [avatarSegment],
    });
  }

  const slideSegments = buildSlideTimeline(
    props.slides,
    props.totalDurationInFrames,
    props.transitionType,
    props.fps,
  );
  if (slideSegments.length > 0) {
    tracks.push({
      id: "slides",
      kind: "slides",
      label: "Slides",
      segments: slideSegments,
    });
  }

  const brollSegments = buildBrollSegments(props);
  if (brollSegments.length > 0) {
    tracks.push({
      id: "broll",
      kind: "broll",
      label: "B-roll",
      segments: brollSegments,
    });
  }

  return {
    fps: props.fps,
    durationInFrames: props.totalDurationInFrames,
    durationInSeconds: props.totalDurationInFrames / props.fps,
    tracks,
  };
}

export function getActiveTimelineSegments(
  timeline: VisualTimeline,
  frame: number,
): VisualTimelineSegment[] {
  const normalizedFrame = clampTimelineFrame(frame, timeline.durationInFrames);

  return timeline.tracks.flatMap((track) =>
    track.segments.filter(
      (segment) =>
        segment.startFrame <= normalizedFrame &&
        normalizedFrame < segment.endFrame,
    ),
  );
}

import { Audio, Sequence, interpolate, useCurrentFrame } from "remotion";
import { REMOTE_MEDIA_RENDER_PROPS } from "../media-rendering.config";
import type { AssemblyVoiceClip } from "../types";
import type { VisualTimelineSegment } from "../visual-timeline";
import {
  getAvatarClipCrossfadeFrames,
  getAvatarSegmentCrossfadeFrames,
} from "../avatar-clip-transitions";

interface AudioTracksProps {
  voiceAudioUrl?: string;
  voiceClips?: AssemblyVoiceClip[];
  avatarSegments?: VisualTimelineSegment[];
  bgMusicUrl?: string;
  bgMusicVolume: number;
}

/**
 * Pistas de audio del ensamblado: locución (una pasada) + música de fondo
 * (en loop hasta cubrir la composición, con volumen atenuado).
 *
 * Nota de diseño (plan 1.3): cuando hay locución y avatar a la vez, el avatar
 * se silencia en su capa de video y la voz maestra suena por aquí.
 */
export function AudioTracks({
  voiceAudioUrl,
  voiceClips = [],
  avatarSegments,
  bgMusicUrl,
  bgMusicVolume,
}: AudioTracksProps) {
  return (
    <>
      {voiceAudioUrl ? <Audio {...REMOTE_MEDIA_RENDER_PROPS} src={voiceAudioUrl} /> : null}
      {!voiceAudioUrl && voiceClips.length > 0 ? (
        <VoiceClipTracks clips={voiceClips} segments={avatarSegments} />
      ) : null}
      {bgMusicUrl ? (
        <Audio
          {...REMOTE_MEDIA_RENDER_PROPS}
          src={bgMusicUrl}
          volume={bgMusicVolume}
          loop
        />
      ) : null}
    </>
  );
}

function VoiceClipAudio({
  clip,
  fadeInFrames,
  fadeOutFrames,
  durationInFrames = clip.durationInFrames,
  trimAfter,
  trimBefore,
}: {
  clip: AssemblyVoiceClip;
  durationInFrames?: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  trimAfter?: number;
  trimBefore?: number;
}) {
  const frame = useCurrentFrame();
  const fadeIn = fadeInFrames > 0
    ? interpolate(frame, [0, fadeInFrames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  const fadeOut = fadeOutFrames > 0
    ? interpolate(
        frame,
        [Math.max(0, durationInFrames - fadeOutFrames), durationInFrames - 1],
        [1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 1;
  return (
    <Audio
      {...REMOTE_MEDIA_RENDER_PROPS}
      src={clip.url}
      trimAfter={trimAfter}
      trimBefore={trimBefore}
      volume={Math.min(fadeIn, fadeOut)}
    />
  );
}

function VoiceClipTracks({
  clips,
  segments,
}: {
  clips: AssemblyVoiceClip[];
  segments?: VisualTimelineSegment[];
}) {
  const ordered = [...clips].sort((left, right) => left.order - right.order);

  if (segments && segments.length > 0) {
    const orderedSegments = [...segments].sort(
      (left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id),
    );
    const segmentByOrder = new Map(orderedSegments.flatMap((segment) => {
      const match = segment.id.match(/^avatar-(\d+)$/);
      return match ? [[Number(match[1]), segment] as const] : [];
    }));
    return ordered.map((clip) => {
      const segment = segmentByOrder.get(clip.order);
      const segmentIndex = segment ? orderedSegments.indexOf(segment) : -1;
      const fades = getAvatarSegmentCrossfadeFrames({
        current: segment || {
          endFrame: (clip.startInFrames || 0) + clip.durationInFrames,
          startFrame: clip.startInFrames || 0,
        },
        previous: segmentIndex > 0 ? orderedSegments[segmentIndex - 1] : undefined,
        next: segmentIndex >= 0 ? orderedSegments[segmentIndex + 1] : undefined,
      });
      const sourceStartFrame = segment?.sourceStartFrame ?? 0;
      const sourceEndFrame = segment?.sourceEndFrame ?? clip.durationInFrames;
      const sequenceDurationInFrames = Math.min(
        segment?.durationInFrames ?? clip.durationInFrames,
        Math.max(1, sourceEndFrame - sourceStartFrame),
      );
      return (
        <Sequence
          key={`voice-${clip.clipId}`}
          from={segment?.startFrame ?? clip.startInFrames ?? 0}
          durationInFrames={sequenceDurationInFrames}
        >
          <VoiceClipAudio
            clip={clip}
            durationInFrames={sequenceDurationInFrames}
            trimAfter={sourceEndFrame}
            trimBefore={sourceStartFrame}
            {...fades}
          />
        </Sequence>
      );
    });
  }

  let cursor = 0;
  return ordered.map((clip, index) => {
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    const fadeInFrames = previous ? getAvatarClipCrossfadeFrames(previous, clip) : 0;
    const fadeOutFrames = next ? getAvatarClipCrossfadeFrames(clip, next) : 0;
    const startFrame = clip.startInFrames ?? cursor;
    cursor = clip.startInFrames === undefined
      ? cursor + Math.max(1, clip.durationInFrames - fadeOutFrames)
      : Math.max(cursor, startFrame + clip.durationInFrames);
    return (
      <Sequence
        key={`voice-${clip.clipId}`}
        from={startFrame}
        durationInFrames={clip.durationInFrames}
      >
        <VoiceClipAudio
          clip={clip}
          fadeInFrames={fadeInFrames}
          fadeOutFrames={fadeOutFrames}
        />
      </Sequence>
    );
  });
}

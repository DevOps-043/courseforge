import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Freeze,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import type { AssemblyAvatarClip } from "../types";
import type { LayoutOverrideStyle } from "../layout-override-styles";
import type { VisualTimelineSegment } from "../visual-timeline";
import { REMOTE_MEDIA_RENDER_PROPS } from "../media-rendering.config";
import {
  getAvatarClipCrossfadeFrames,
  getAvatarSegmentCrossfadeFrames,
} from "../avatar-clip-transitions";
import { resolveSafeRemoteVideoRange } from "../remote-video-source-range";

interface AvatarClipLayerProps {
  clips: AssemblyAvatarClip[];
  muted: boolean;
  objectFit?: CSSProperties["objectFit"];
  style?: CSSProperties;
  segments?: VisualTimelineSegment[];
  getClipStyle?: (clip: AssemblyAvatarClip) => LayoutOverrideStyle;
}

function AvatarClipVideo({
  clip,
  durationInFrames,
  fadeInFrames = 0,
  fadeOutFrames = 0,
  muted,
  objectFit,
  segment,
  style,
}: {
  clip: AssemblyAvatarClip;
  durationInFrames: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  muted: boolean;
  objectFit: CSSProperties["objectFit"];
  segment?: VisualTimelineSegment;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const sourceRange = resolveSafeRemoteVideoRange({
    sourceStartFrame: segment?.sourceStartFrame,
    sourceEndFrame: segment?.sourceEndFrame,
    fallbackDurationInFrames: clip.durationInFrames,
    sequenceDurationInFrames: durationInFrames,
  });
  const fadeInOpacity =
    fadeInFrames > 0
      ? interpolate(frame, [0, fadeInFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  const fadeOutOpacity =
    fadeOutFrames > 0
      ? interpolate(
          frame,
          [Math.max(0, durationInFrames - fadeOutFrames), durationInFrames - 1],
          [1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        )
      : 1;
  const opacity = Math.min(fadeInOpacity, fadeOutOpacity);

  const video = (
    <OffthreadVideo
      {...REMOTE_MEDIA_RENDER_PROPS}
      src={clip.url}
      muted={muted}
      volume={muted ? 0 : opacity}
      startFrom={sourceRange.sourceStartFrame}
      endAt={sourceRange.sourceEndFrame}
      onError={(err) => {
        console.warn("[Remotion preview] Clip de avatar no reproducible:", clip.url, err);
      }}
      style={{ width: "100%", height: "100%", objectFit, opacity, ...style }}
    />
  );

  if (sourceRange.tailFreezeInFrames <= 0) {
    return video;
  }

  return (
    <>
      <Sequence from={0} durationInFrames={sourceRange.sourceDurationInFrames}>
        {video}
      </Sequence>
      <Sequence
        from={sourceRange.sourceDurationInFrames}
        durationInFrames={sourceRange.tailFreezeInFrames}
      >
        <Freeze frame={sourceRange.sourceDurationInFrames - 1}>{video}</Freeze>
      </Sequence>
    </>
  );
}

/** Reproduce clips de avatar en secuencia, respetando la duracion real de cada clip. */
export function AvatarClipLayer({
  clips,
  muted,
  objectFit = "cover",
  style,
  segments,
  getClipStyle,
}: AvatarClipLayerProps) {
  if (clips.length === 0) {
    return null;
  }

  const ordered = [...clips].sort((a, b) => a.order - b.order);
  const clipByOrder = new Map(ordered.map((clip) => [clip.order, clip] as const));

  if (segments && segments.length > 0) {
    const orderedSegments = [...segments].sort(
      (left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id),
    );

    return (
      <>
        {orderedSegments.flatMap((segment, index) => {
          const orderMatch = segment.id.match(/^avatar-(\d+)$/);
          const clip = orderMatch ? clipByOrder.get(Number(orderMatch[1])) : undefined;
          if (!clip) return [];
          const { fadeInFrames, fadeOutFrames } = getAvatarSegmentCrossfadeFrames({
            current: segment,
            previous: orderedSegments[index - 1],
            next: orderedSegments[index + 1],
          });

          return (
            <Sequence
              key={segment.id}
              from={segment.startFrame}
              durationInFrames={segment.durationInFrames}
            >
              <AbsoluteFill
                style={{
                  backgroundColor: "transparent",
                  ...style,
                  ...getClipStyle?.(clip),
                }}
              >
                <AvatarClipVideo
                  clip={clip}
                  durationInFrames={segment.durationInFrames}
                  fadeInFrames={fadeInFrames}
                  fadeOutFrames={fadeOutFrames}
                  muted={muted}
                  objectFit={objectFit}
                  segment={segment}
                />
              </AbsoluteFill>
            </Sequence>
          );
        })}
      </>
    );
  }

  let cursor = 0;

  return (
    <>
      {ordered.map((clip, index) => {
        const previousClip = ordered[index - 1];
        const nextClip = ordered[index + 1];
        const startFrame = cursor;
        const fadeInFrames = previousClip
          ? getAvatarClipCrossfadeFrames(previousClip, clip)
          : 0;
        const fadeOutFrames = nextClip
          ? getAvatarClipCrossfadeFrames(clip, nextClip)
          : 0;
        cursor += Math.max(1, clip.durationInFrames - fadeOutFrames);

        return (
          <Sequence
            key={`${clip.order}-${index}`}
            from={startFrame}
            durationInFrames={clip.durationInFrames}
          >
            <AbsoluteFill
              style={{
                backgroundColor: "transparent",
                ...style,
                ...getClipStyle?.(clip),
              }}
            >
              <AvatarClipVideo
                clip={clip}
                durationInFrames={clip.durationInFrames}
                fadeInFrames={fadeInFrames}
                fadeOutFrames={fadeOutFrames}
                muted={muted}
                objectFit={objectFit}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </>
  );
}

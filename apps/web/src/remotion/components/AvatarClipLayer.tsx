import type { CSSProperties } from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, Series } from "remotion";
import type { AssemblyAvatarClip } from "../types";
import type { LayoutOverrideStyle } from "../layout-override-styles";
import type { VisualTimelineSegment } from "../visual-timeline";

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
  muted,
  objectFit,
  segment,
  style,
}: {
  clip: AssemblyAvatarClip;
  muted: boolean;
  objectFit: CSSProperties["objectFit"];
  segment?: VisualTimelineSegment;
  style?: CSSProperties;
}) {
  const sourceStartFrame = Math.max(0, segment?.sourceStartFrame ?? 0);
  const sourceEndFrame = Math.max(
    sourceStartFrame + 1,
    segment?.sourceEndFrame ?? clip.durationInFrames,
  );

  return (
    <OffthreadVideo
      src={clip.url}
      muted={muted}
      startFrom={sourceStartFrame}
      endAt={sourceEndFrame}
      onError={(err) => {
        console.warn("[Remotion preview] Clip de avatar no reproducible:", clip.url, err);
      }}
      style={{ width: "100%", height: "100%", objectFit, ...style }}
    />
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
    return (
      <>
        {segments.flatMap((segment) => {
          const orderMatch = segment.id.match(/^avatar-(\d+)$/);
          const clip = orderMatch ? clipByOrder.get(Number(orderMatch[1])) : undefined;
          if (!clip) return [];
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

  return (
    <Series>
      {ordered.map((clip, index) => (
        <Series.Sequence
          key={`${clip.order}-${index}`}
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
              muted={muted}
              objectFit={objectFit}
            />
          </AbsoluteFill>
        </Series.Sequence>
      ))}
    </Series>
  );
}

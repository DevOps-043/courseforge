import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Loop,
  OffthreadVideo,
  Sequence,
  Series,
  interpolate,
  useCurrentFrame,
} from "remotion";
import type { AssemblyBrollClip } from "../types";
import type { LayoutOverrideStyle } from "../layout-override-styles";
import type { VisualTimelineSegment } from "../visual-timeline";
import { REMOTE_MEDIA_RENDER_PROPS } from "../media-rendering.config";

const BROLL_FADE_FRAMES = 8;

function getFadeOpacity(frame: number, durationInFrames: number) {
  const fadeFrames = Math.min(BROLL_FADE_FRAMES, Math.max(0, Math.floor(durationInFrames / 2)));
  if (fadeFrames <= 0) return 1;

  const fadeInOpacity = interpolate(frame, [0, fadeFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOutOpacity = interpolate(
    frame,
    [Math.max(0, durationInFrames - fadeFrames), Math.max(0, durationInFrames - 1)],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return Math.min(fadeInOpacity, fadeOutOpacity);
}

interface BrollLayerProps {
  clips: AssemblyBrollClip[];
  style?: CSSProperties;
  segments?: VisualTimelineSegment[];
  getClipStyle?: (clip: AssemblyBrollClip) => LayoutOverrideStyle;
}

function BrollVideo({
  clip,
  segment,
  style,
}: {
  clip: AssemblyBrollClip;
  segment?: VisualTimelineSegment;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const durationInFrames = segment?.durationInFrames ?? clip.durationInFrames;
  const sourceStartFrame = Math.max(0, Math.round(segment?.sourceStartFrame ?? 0));
  const sourceEndFrame = Math.max(
    sourceStartFrame + 1,
    Math.round(segment?.sourceEndFrame ?? clip.durationInFrames),
  );
  const sourceDurationInFrames = sourceEndFrame - sourceStartFrame;
  const opacity = getFadeOpacity(frame, durationInFrames);
  const video = (
    <OffthreadVideo
      {...REMOTE_MEDIA_RENDER_PROPS}
      src={clip.url}
      muted
      startFrom={sourceStartFrame}
      endAt={sourceEndFrame}
      style={{ width: "100%", height: "100%", objectFit: "cover", opacity, ...style }}
    />
  );

  if (!segment || segment.durationInFrames <= sourceDurationInFrames) {
    return video;
  }

  if (segment.loopMode === "loop") {
    return <Loop durationInFrames={sourceDurationInFrames}>{video}</Loop>;
  }

  return video;
}

/**
 * Reproduce los clips de B-roll en secuencia, cada uno por su duración propia.
 * Va silenciado: el audio del ensamblado proviene de las pistas de voz/música.
 *
 * Degrada con gracia: 0 clips => no renderiza nada.
 */
export function BrollLayer({ clips, style, segments, getClipStyle }: BrollLayerProps) {
  if (clips.length === 0) {
    return null;
  }

  const ordered = [...clips].sort((a, b) => a.order - b.order);
  const clipByOrder = new Map(ordered.map((clip) => [clip.order, clip] as const));

  if (segments && segments.length > 0) {
    return (
      <>
        {segments.flatMap((segment) => {
          const orderMatch = segment.id.match(/^broll-(\d+)$/);
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
                <BrollVideo clip={clip} segment={segment} />
              </AbsoluteFill>
            </Sequence>
          );
        })}
      </>
    );
  }

  return (
    <Series>
      {ordered.map((clip, i) => (
        <Series.Sequence
          key={`${clip.order}-${i}`}
          durationInFrames={clip.durationInFrames}
        >
          <AbsoluteFill
            style={{
              backgroundColor: "transparent",
              ...style,
              ...getClipStyle?.(clip),
            }}
          >
            <BrollVideo clip={clip} />
          </AbsoluteFill>
        </Series.Sequence>
      ))}
    </Series>
  );
}

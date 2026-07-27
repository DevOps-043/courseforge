import type { CSSProperties } from "react";
import { AbsoluteFill, Loop, OffthreadVideo, Sequence } from "remotion";
import type { AssemblyBrollClip } from "../types";
import type { LayoutOverrideStyle } from "../layout-override-styles";
import { buildBrollTimeline, type VisualTimelineSegment } from "../visual-timeline";

interface BrollOverlayLayerProps {
  clips: AssemblyBrollClip[];
  durationInFrames: number;
  segments?: VisualTimelineSegment[];
  containerStyle?: CSSProperties;
  getClipStyle?: (clip: AssemblyBrollClip) => LayoutOverrideStyle;
}

function OverlayVideo({
  clip,
  segment,
}: {
  clip: AssemblyBrollClip;
  segment?: VisualTimelineSegment;
}) {
  const sourceStartFrame = Math.max(0, segment?.sourceStartFrame ?? 0);
  const sourceEndFrame = Math.max(
    sourceStartFrame + 1,
    segment?.sourceEndFrame ?? clip.durationInFrames,
  );
  const sourceDurationInFrames = sourceEndFrame - sourceStartFrame;
  const video = (
    <OffthreadVideo
      src={clip.url}
      muted
      startFrom={sourceStartFrame}
      endAt={sourceEndFrame}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
  );

  if (!segment || segment.durationInFrames <= sourceDurationInFrames || segment.loopMode !== "loop") {
    return video;
  }

  return <Loop durationInFrames={sourceDurationInFrames}>{video}</Loop>;
}

export function BrollOverlayLayer({
  clips,
  durationInFrames,
  segments,
  containerStyle,
  getClipStyle,
}: BrollOverlayLayerProps) {
  const clipByOrder = new Map(clips.map((clip) => [clip.order, clip] as const));
  const timeline = segments && segments.length > 0
    ? segments.flatMap((segment) => {
        const orderMatch = segment.id.match(/^broll-(\d+)$/);
        const clip = orderMatch ? clipByOrder.get(Number(orderMatch[1])) : undefined;
        return clip
          ? [{ clip, startFrame: segment.startFrame, durationInFrames: segment.durationInFrames, segment }]
          : [];
      })
    : buildBrollTimeline(clips, durationInFrames).map((item) => ({ ...item, segment: undefined }));

  if (timeline.length === 0) {
    return null;
  }

  return (
    <>
      {timeline.map((item, index) => {
        const clipStyle = getClipStyle?.(item.clip);
        return (
          <Sequence
            key={`${item.clip.order}-${index}`}
            from={item.startFrame}
            durationInFrames={item.durationInFrames}
          >
            <AbsoluteFill
              style={{
                pointerEvents: "none",
                justifyContent: "flex-end",
                alignItems: "flex-end",
                padding: 48,
              }}
            >
              <div
                style={{
                  width: "34%",
                  aspectRatio: "16 / 9",
                  borderRadius: 18,
                  overflow: "hidden",
                  backgroundColor: "transparent",
                  border: "2px solid rgba(255,255,255,0.18)",
                  boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
                  ...containerStyle,
                  ...clipStyle,
                }}
              >
                <OverlayVideo clip={item.clip} segment={item.segment} />
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </>
  );
}

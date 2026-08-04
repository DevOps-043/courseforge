import type { CSSProperties } from "react";
import { AbsoluteFill, Freeze, Loop, OffthreadVideo, Sequence } from "remotion";
import type { AssemblyBrollClip } from "../types";
import type { LayoutOverrideStyle } from "../layout-override-styles";
import { buildBrollTimeline, type VisualTimelineSegment } from "../visual-timeline";
import { REMOTE_MEDIA_RENDER_PROPS } from "../media-rendering.config";
import { resolveSafeRemoteVideoRange } from "../remote-video-source-range";

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
  const sourceRange = resolveSafeRemoteVideoRange({
    sourceStartFrame: segment?.sourceStartFrame,
    sourceEndFrame: segment?.sourceEndFrame,
    fallbackDurationInFrames: clip.durationInFrames,
    sequenceDurationInFrames: segment?.durationInFrames ?? clip.durationInFrames,
  });
  const video = (
    <OffthreadVideo
      {...REMOTE_MEDIA_RENDER_PROPS}
      src={clip.url}
      muted
      startFrom={sourceRange.sourceStartFrame}
      endAt={sourceRange.sourceEndFrame}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
  );

  if (!segment || segment.durationInFrames <= sourceRange.sourceDurationInFrames) {
    return video;
  }

  if (segment.loopMode === "loop") {
    return <Loop durationInFrames={sourceRange.sourceDurationInFrames}>{video}</Loop>;
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

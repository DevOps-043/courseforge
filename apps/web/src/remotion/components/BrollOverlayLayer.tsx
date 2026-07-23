import type { CSSProperties } from "react";
import { AbsoluteFill, OffthreadVideo, Sequence } from "remotion";
import type { AssemblyBrollClip } from "../types";
import type { LayoutOverrideStyle } from "../layout-override-styles";
import { buildBrollTimeline } from "../visual-timeline";

interface BrollOverlayLayerProps {
  clips: AssemblyBrollClip[];
  durationInFrames: number;
  containerStyle?: CSSProperties;
  getClipStyle?: (clip: AssemblyBrollClip) => LayoutOverrideStyle;
}

export function BrollOverlayLayer({
  clips,
  durationInFrames,
  containerStyle,
  getClipStyle,
}: BrollOverlayLayerProps) {
  const timeline = buildBrollTimeline(clips, durationInFrames);

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
                <OffthreadVideo
                  src={item.clip.url}
                  muted
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </>
  );
}

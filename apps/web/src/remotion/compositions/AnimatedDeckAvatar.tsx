import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { AssemblyInputProps } from "../types";
import { AvatarClipLayer } from "../components/AvatarClipLayer";
import { AvatarLayer } from "../components/AvatarLayer";
import { AudioTracks } from "../components/AudioTracks";
import { PrimaryVisual } from "../components/PrimaryVisual";
import { parseTemplateRenderConfig } from "../template-config";
import { buildVisualTimeline } from "../visual-timeline";

const PANEL_WIDTH = 820;
const PANEL_HEIGHT = (PANEL_WIDTH * 1080) / 1920;
const PANEL_MARGIN = 64;
const FOCUS_RAMP_FRAMES = 27;

function getSlideFocus(frame: number, props: AssemblyInputProps) {
  if (props.slides.length === 0) {
    return 0;
  }

  const timeline = buildVisualTimeline(props);
  const slideSegments = timeline.tracks
    .flatMap((track) => track.segments)
    .filter((segment) => segment.trackKind === "slides");

  for (const segment of slideSegments) {
    if (frame < segment.startFrame || frame >= segment.endFrame) continue;

    const local = frame - segment.startFrame;
    const rampOutStart = segment.durationInFrames - FOCUS_RAMP_FRAMES;
    if (local < FOCUS_RAMP_FRAMES) {
      return local / FOCUS_RAMP_FRAMES;
    }
    if (local > rampOutStart) {
      return (segment.durationInFrames - local) / FOCUS_RAMP_FRAMES;
    }
    return 1;
  }

  return 0;
}

export function AnimatedDeckAvatar(props: AssemblyInputProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const templateConfig = parseTemplateRenderConfig(props.templateConfig);
  const timeline = buildVisualTimeline(props);
  const timelineSegments = timeline.tracks.flatMap((track) => track.segments);
  const avatarSegments = timelineSegments.filter((segment) => segment.trackKind === "avatar");
  const hasVoice = Boolean(props.voiceAudioUrl);
  const hasAvatar = props.avatarClips.length > 0 || Boolean(props.avatarVideoUrl);
  const focus = getSlideFocus(frame, props);
  const globalProgress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const avatarScale = 1 + globalProgress * 0.035 + focus * 0.045;
  const avatarShift = interpolate(focus, [0, 1], [0, -46], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const panelEnter = interpolate(frame, [0, 21], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const panelOffset = interpolate(panelEnter, [0, 1], [110, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: templateConfig.backgroundColor }}>
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            transform: `translateX(${avatarShift}px) scale(${avatarScale})`,
            transformOrigin: "center center",
            width: "100%",
          }}
        >
          {props.avatarClips.length > 0 ? (
            <AvatarClipLayer clips={props.avatarClips} muted={hasVoice} segments={avatarSegments} />
          ) : props.avatarVideoUrl ? (
            <AvatarLayer url={props.avatarVideoUrl} muted={hasVoice} />
          ) : (
            <AbsoluteFill
              style={{
                background:
                  templateConfig.backgroundStyle === "solid"
                    ? templateConfig.backgroundColor
                    : `linear-gradient(135deg, ${templateConfig.surfaceColor} 0%, ${templateConfig.backgroundColor} 100%)`,
              }}
            />
          )}
        </div>
        {hasAvatar && (
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(90deg, rgba(5,7,11,0.12) 0%, rgba(5,7,11,0.72) 100%)",
              opacity: focus * 0.88,
            }}
          />
        )}
      </AbsoluteFill>

      <div
        style={{
          boxShadow: "0 30px 80px rgba(0,0,0,0.42)",
          height: PANEL_HEIGHT,
          opacity: panelEnter * (0.96 + focus * 0.04),
          overflow: "hidden",
          position: "absolute",
          right: PANEL_MARGIN,
          top: (1080 - PANEL_HEIGHT) / 2,
          transform: `translateX(${panelOffset}px) scale(${1 + focus * 0.1})`,
          transformOrigin: "right center",
          width: PANEL_WIDTH,
        }}
      >
        <PrimaryVisual
          brollClips={props.brollClips}
          deckCss={props.deckCss}
          deckFonts={props.deckFonts}
          durationInFrames={durationInFrames}
          layoutOverrides={props.layoutOverrides}
          slides={props.slides}
          templateConfig={templateConfig}
          timelineSegments={timelineSegments}
          transitionType={props.transitionType}
        />
      </div>

      <AudioTracks
        bgMusicUrl={props.bgMusicUrl}
        bgMusicVolume={props.bgMusicVolume}
        voiceAudioUrl={props.voiceAudioUrl}
      />
    </AbsoluteFill>
  );
}

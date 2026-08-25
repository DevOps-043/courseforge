import { AbsoluteFill, useVideoConfig } from "remotion";
import type { AssemblyInputProps } from "../types";
import { PrimaryVisual } from "../components/PrimaryVisual";
import { AvatarLayer } from "../components/AvatarLayer";
import { AvatarClipLayer } from "../components/AvatarClipLayer";
import { AudioTracks } from "../components/AudioTracks";
import { parseTemplateRenderConfig } from "../template-config";
import {
  buildLayoutOverrideStyle,
  getAvatarClipItemLayerId,
  REMOTION_EDITABLE_LAYERS,
} from "../layout-override-styles";
import { buildVisualTimeline } from "../visual-timeline";

/**
 * Plantilla "Presentación + Avatar (Dividida)": recurso visual a la izquierda,
 * avatar a la derecha. Si falta el avatar, el lado derecho queda en fondo neutro.
 */
export function SplitAvatar(props: AssemblyInputProps) {
  const { durationInFrames } = useVideoConfig();
  const hasVoice = Boolean(props.voiceAudioUrl || props.voiceClips.length > 0);
  const templateConfig = parseTemplateRenderConfig(props.templateConfig);
  const primaryVisualOverrideStyle = buildLayoutOverrideStyle(
    props.layoutOverrides,
    REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL,
  );
  const slidesOverrideStyle = buildLayoutOverrideStyle(
    props.layoutOverrides,
    REMOTION_EDITABLE_LAYERS.SLIDES,
  );
  const brollOverrideStyle = buildLayoutOverrideStyle(
    props.layoutOverrides,
    REMOTION_EDITABLE_LAYERS.BROLL,
  );
  const avatarOverrideStyle = buildLayoutOverrideStyle(
    props.layoutOverrides,
    REMOTION_EDITABLE_LAYERS.AVATAR,
  );
  const fallbackBackground =
    templateConfig.backgroundStyle === "solid"
      ? templateConfig.backgroundColor
      : `linear-gradient(135deg, ${templateConfig.surfaceColor} 0%, ${templateConfig.backgroundColor} 100%)`;
  const timelineSegments = buildVisualTimeline(props).tracks.flatMap((track) => track.segments);
  const avatarSegments = timelineSegments.filter((segment) => segment.trackKind === "avatar");
  const hasAvatar = props.avatarClips.length > 0 || Boolean(props.avatarVideoUrl);

  return (
    <AbsoluteFill
      style={{ backgroundColor: templateConfig.backgroundColor, flexDirection: "row" }}
    >
      <div
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          zIndex: 10,
          ...primaryVisualOverrideStyle,
        }}
      >
        <PrimaryVisual
          slides={props.slides}
          brollClips={props.brollClips}
          durationInFrames={durationInFrames}
          transitionType={props.transitionType}
          deckCss={props.deckCss}
          deckFonts={props.deckFonts}
          templateConfig={templateConfig}
          layoutOverrides={props.layoutOverrides}
          timelineSegments={timelineSegments}
          slidesLayerStyle={slidesOverrideStyle}
          brollLayerStyle={brollOverrideStyle}
        />
      </div>

      <div
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          zIndex: 20,
          ...avatarOverrideStyle,
        }}
      >
        {props.avatarClips.length > 0 ? (
            <AvatarClipLayer
              clips={props.avatarClips}
              muted={hasVoice}
              segments={avatarSegments}
              getClipStyle={(clip) =>
                buildLayoutOverrideStyle(
                  props.layoutOverrides,
                  getAvatarClipItemLayerId(clip.order),
                )
              }
            />
        ) : props.avatarVideoUrl ? (
          <AvatarLayer
            url={props.avatarVideoUrl}
            durationInFrames={durationInFrames}
            muted={hasVoice}
          />
        ) : hasAvatar ? (
          null
        ) : (
          <AbsoluteFill
            style={{
              background: fallbackBackground,
            }}
          />
        )}
      </div>

      <AudioTracks
        avatarSegments={avatarSegments}
        voiceAudioUrl={props.voiceAudioUrl}
        voiceClips={props.voiceClips}
        bgMusicUrl={props.bgMusicUrl}
        bgMusicVolume={props.bgMusicVolume}
      />
    </AbsoluteFill>
  );
}

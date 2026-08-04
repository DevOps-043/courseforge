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
 * Plantilla "Avatar Enfocado": el avatar ocupa el centro de la pantalla y, si
 * hay slides/B-roll, estas aparecen como franja de apoyo inferior.
 *
 * Sin avatar, degrada a recurso visual a pantalla completa (no deja la pantalla
 * en negro).
 */
export function AvatarFocus(props: AssemblyInputProps) {
  const { durationInFrames } = useVideoConfig();
  const hasVoice = Boolean(props.voiceAudioUrl);
  const templateConfig = parseTemplateRenderConfig(props.templateConfig);
  const hasSupportVisual =
    props.slides.length > 0 || props.brollClips.length > 0;
  const avatarOverrideStyle = buildLayoutOverrideStyle(
    props.layoutOverrides,
    REMOTION_EDITABLE_LAYERS.AVATAR,
  );
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
  const supportStripOverrideStyle = buildLayoutOverrideStyle(
    props.layoutOverrides,
    REMOTION_EDITABLE_LAYERS.SUPPORT_STRIP,
  );
  const timelineSegments = buildVisualTimeline(props).tracks.flatMap((track) => track.segments);
  const avatarSegments = timelineSegments.filter((segment) => segment.trackKind === "avatar");
  const hasAvatar = props.avatarClips.length > 0 || Boolean(props.avatarVideoUrl);

  return (
    <AbsoluteFill style={{ backgroundColor: templateConfig.backgroundColor }}>
      {hasAvatar ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            ...avatarOverrideStyle,
          }}
        >
          {props.avatarClips.length > 0 ? (
            <AvatarClipLayer
              clips={props.avatarClips}
              muted={hasVoice}
              objectFit="contain"
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
              objectFit="contain"
            />
          ) : null}
        </div>
      ) : (
        <div style={{ position: "absolute", inset: 0, ...primaryVisualOverrideStyle }}>
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
      )}

      {hasAvatar && hasSupportVisual ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: `${templateConfig.supportStripHeight * 100}%`,
            overflow: "hidden",
            borderTop: `3px solid ${templateConfig.accentColor}`,
            boxShadow: "0 -8px 24px rgba(0,0,0,0.4)",
            zIndex: 20,
            ...supportStripOverrideStyle,
          }}
        >
          <div style={{ position: "absolute", inset: 0, ...primaryVisualOverrideStyle }}>
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
        </div>
      ) : null}

      <AudioTracks
        voiceAudioUrl={props.voiceAudioUrl}
        bgMusicUrl={props.bgMusicUrl}
        bgMusicVolume={props.bgMusicVolume}
      />
    </AbsoluteFill>
  );
}

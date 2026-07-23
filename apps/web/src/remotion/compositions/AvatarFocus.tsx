import { AbsoluteFill, useVideoConfig } from "remotion";
import type { AssemblyInputProps } from "../types";
import { PrimaryVisual } from "../components/PrimaryVisual";
import { AvatarLayer } from "../components/AvatarLayer";
import { AudioTracks } from "../components/AudioTracks";
import { parseTemplateRenderConfig } from "../template-config";
import {
  buildLayoutOverrideStyle,
  REMOTION_EDITABLE_LAYERS,
} from "../layout-override-styles";

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

  return (
    <AbsoluteFill style={{ backgroundColor: templateConfig.backgroundColor }}>
      {props.avatarVideoUrl ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            ...avatarOverrideStyle,
          }}
        >
          <AvatarLayer
            url={props.avatarVideoUrl}
            muted={hasVoice}
            objectFit="contain"
          />
        </div>
      ) : (
        <div style={{ position: "absolute", inset: 0, ...primaryVisualOverrideStyle }}>
          <PrimaryVisual
            slides={props.slides}
            brollClips={props.brollClips}
            durationInFrames={durationInFrames}
            transitionType={props.transitionType}
            templateConfig={templateConfig}
            layoutOverrides={props.layoutOverrides}
            slidesLayerStyle={slidesOverrideStyle}
            brollLayerStyle={brollOverrideStyle}
          />
        </div>
      )}

      {props.avatarVideoUrl && hasSupportVisual ? (
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
              templateConfig={templateConfig}
              layoutOverrides={props.layoutOverrides}
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

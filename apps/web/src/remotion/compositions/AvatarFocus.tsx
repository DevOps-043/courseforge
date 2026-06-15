import { AbsoluteFill, useVideoConfig } from "remotion";
import type { AssemblyInputProps } from "../types";
import { PrimaryVisual } from "../components/PrimaryVisual";
import { AvatarLayer } from "../components/AvatarLayer";
import { AudioTracks } from "../components/AudioTracks";
import { parseTemplateRenderConfig } from "../template-config";

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

  return (
    <AbsoluteFill style={{ backgroundColor: templateConfig.backgroundColor }}>
      {props.avatarVideoUrl ? (
        <AvatarLayer
          url={props.avatarVideoUrl}
          muted={hasVoice}
          objectFit="contain"
        />
      ) : (
        <PrimaryVisual
          slides={props.slides}
          brollClips={props.brollClips}
          durationInFrames={durationInFrames}
          transitionType={props.transitionType}
          templateConfig={templateConfig}
        />
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
          }}
        >
          <PrimaryVisual
            slides={props.slides}
            brollClips={props.brollClips}
            durationInFrames={durationInFrames}
            transitionType={props.transitionType}
            templateConfig={templateConfig}
          />
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

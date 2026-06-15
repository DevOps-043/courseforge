import { AbsoluteFill, useVideoConfig } from "remotion";
import type { AssemblyInputProps } from "../types";
import { PrimaryVisual } from "../components/PrimaryVisual";
import { AvatarLayer } from "../components/AvatarLayer";
import { AudioTracks } from "../components/AudioTracks";
import { parseTemplateRenderConfig } from "../template-config";

function getAvatarPositionStyle(position: string) {
  const vertical = position.startsWith("top") ? { top: 48 } : { bottom: 48 };
  const horizontal = position.endsWith("left") ? { left: 48 } : { right: 48 };

  return { ...vertical, ...horizontal };
}

/**
 * Plantilla "Presentación Completa": el recurso visual principal ocupa toda la
 * pantalla. Si hay avatar, aparece como picture-in-picture abajo a la derecha.
 */
export function FullSlides(props: AssemblyInputProps) {
  const { durationInFrames } = useVideoConfig();
  const hasVoice = Boolean(props.voiceAudioUrl);
  const templateConfig = parseTemplateRenderConfig(props.templateConfig);

  return (
    <AbsoluteFill style={{ backgroundColor: templateConfig.backgroundColor }}>
      <PrimaryVisual
        slides={props.slides}
        brollClips={props.brollClips}
        durationInFrames={durationInFrames}
        transitionType={props.transitionType}
        templateConfig={templateConfig}
      />

      {props.avatarVideoUrl ? (
        <div
          style={{
            position: "absolute",
            ...getAvatarPositionStyle(templateConfig.avatarPosition),
            width: `${templateConfig.avatarScale * 100}%`,
            aspectRatio: "16 / 9",
            borderRadius: 16,
            overflow: "hidden",
            border: `3px solid ${templateConfig.accentColor}`,
            boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
          }}
        >
          <AvatarLayer url={props.avatarVideoUrl} muted={hasVoice} />
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

import { AbsoluteFill, useVideoConfig } from "remotion";
import type { AssemblyInputProps } from "../types";
import { PrimaryVisual } from "../components/PrimaryVisual";
import { AvatarLayer } from "../components/AvatarLayer";
import { AudioTracks } from "../components/AudioTracks";
import { parseTemplateRenderConfig } from "../template-config";

/**
 * Plantilla "Presentación + Avatar (Dividida)": recurso visual a la izquierda,
 * avatar a la derecha. Si falta el avatar, el lado derecho queda en fondo neutro.
 */
export function SplitAvatar(props: AssemblyInputProps) {
  const { durationInFrames } = useVideoConfig();
  const hasVoice = Boolean(props.voiceAudioUrl);
  const templateConfig = parseTemplateRenderConfig(props.templateConfig);
  const fallbackBackground =
    templateConfig.backgroundStyle === "solid"
      ? templateConfig.backgroundColor
      : `linear-gradient(135deg, ${templateConfig.surfaceColor} 0%, ${templateConfig.backgroundColor} 100%)`;

  return (
    <AbsoluteFill
      style={{ backgroundColor: templateConfig.backgroundColor, flexDirection: "row" }}
    >
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <PrimaryVisual
          slides={props.slides}
          brollClips={props.brollClips}
          durationInFrames={durationInFrames}
          transitionType={props.transitionType}
          templateConfig={templateConfig}
        />
      </div>

      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {props.avatarVideoUrl ? (
          <AvatarLayer url={props.avatarVideoUrl} muted={hasVoice} />
        ) : (
          <AbsoluteFill
            style={{
              background: fallbackBackground,
            }}
          />
        )}
      </div>

      <AudioTracks
        voiceAudioUrl={props.voiceAudioUrl}
        bgMusicUrl={props.bgMusicUrl}
        bgMusicVolume={props.bgMusicVolume}
      />
    </AbsoluteFill>
  );
}

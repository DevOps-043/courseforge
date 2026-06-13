import { AbsoluteFill, useVideoConfig } from "remotion";
import type { AssemblyInputProps } from "../types";
import { PrimaryVisual } from "../components/PrimaryVisual";
import { AvatarLayer } from "../components/AvatarLayer";
import { AudioTracks } from "../components/AudioTracks";

/**
 * Plantilla "Presentación + Avatar (Dividida)": recurso visual a la izquierda,
 * avatar a la derecha. Si falta el avatar, el lado derecho queda en fondo neutro.
 */
export function SplitAvatar(props: AssemblyInputProps) {
  const { durationInFrames } = useVideoConfig();
  const hasVoice = Boolean(props.voiceAudioUrl);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0b0f", flexDirection: "row" }}>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <PrimaryVisual
          slides={props.slides}
          brollClips={props.brollClips}
          durationInFrames={durationInFrames}
          transitionType={props.transitionType}
        />
      </div>

      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {props.avatarVideoUrl ? (
          <AvatarLayer url={props.avatarVideoUrl} muted={hasVoice} />
        ) : (
          <AbsoluteFill
            style={{
              background: "linear-gradient(135deg, #151A21 0%, #0b0b0f 100%)",
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
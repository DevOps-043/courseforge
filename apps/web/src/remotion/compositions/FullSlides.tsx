import { AbsoluteFill, useVideoConfig } from "remotion";
import type { AssemblyInputProps } from "../types";
import { PrimaryVisual } from "../components/PrimaryVisual";
import { AvatarLayer } from "../components/AvatarLayer";
import { AudioTracks } from "../components/AudioTracks";

/**
 * Plantilla "Presentación Completa": el recurso visual principal ocupa toda la
 * pantalla. Si hay avatar, aparece como picture-in-picture abajo a la derecha.
 */
export function FullSlides(props: AssemblyInputProps) {
  const { durationInFrames } = useVideoConfig();
  const hasVoice = Boolean(props.voiceAudioUrl);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <PrimaryVisual
        slides={props.slides}
        brollClips={props.brollClips}
        durationInFrames={durationInFrames}
        transitionType={props.transitionType}
      />

      {props.avatarVideoUrl ? (
        <div
          style={{
            position: "absolute",
            right: 48,
            bottom: 48,
            width: "24%",
            aspectRatio: "16 / 9",
            borderRadius: 16,
            overflow: "hidden",
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
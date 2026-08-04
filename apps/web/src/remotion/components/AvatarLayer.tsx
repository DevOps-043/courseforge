import { CSSProperties } from "react";
import { AbsoluteFill, OffthreadVideo } from "remotion";
import { REMOTE_MEDIA_RENDER_PROPS } from "../media-rendering.config";

interface AvatarLayerProps {
  url: string;
  durationInFrames: number;
  /**
   * Silencia la pista nativa del avatar. Se activa cuando existe una locucion
   * maestra separada que debe sustituir al audio del avatar (plan 1.3).
   */
  muted: boolean;
  objectFit?: CSSProperties["objectFit"];
}

/** Capa de video del avatar (talking head). */
export function AvatarLayer({
  url,
  durationInFrames,
  muted,
  objectFit = "cover",
}: AvatarLayerProps) {
  return (
    <AbsoluteFill>
    <OffthreadVideo
      {...REMOTE_MEDIA_RENDER_PROPS}
      src={url}
      muted={muted}
      startFrom={0}
      endAt={durationInFrames}
      // En el Player, un hipo de reproduccion del avatar no debe tumbar el preview.
      onError={(err) => {
        console.warn("[Remotion preview] Avatar no reproducible:", url, err);
      }}
      style={{ width: "100%", height: "100%", objectFit }}
    />
    </AbsoluteFill>
  );
}

import { CSSProperties } from "react";
import { AbsoluteFill, OffthreadVideo } from "remotion";

interface AvatarLayerProps {
  url: string;
  /**
   * Silencia la pista nativa del avatar. Se activa cuando existe una locución
   * maestra separada que debe sustituir al audio del avatar (plan 1.3).
   */
  muted: boolean;
  objectFit?: CSSProperties["objectFit"];
}

/** Capa de video del avatar (talking head). */
export function AvatarLayer({
  url,
  muted,
  objectFit = "cover",
}: AvatarLayerProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <OffthreadVideo
        src={url}
        muted={muted}
        style={{ width: "100%", height: "100%", objectFit }}
      />
    </AbsoluteFill>
  );
}
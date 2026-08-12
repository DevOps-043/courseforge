import { CSSProperties } from "react";
import { AbsoluteFill, Freeze, Sequence } from "remotion";
import { Video } from "@remotion/media";
import { REMOTE_MEDIA_RENDER_PROPS } from "../media-rendering.config";
import { resolveSafeRemoteVideoRange } from "../remote-video-source-range";

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
  const sourceRange = resolveSafeRemoteVideoRange({
    fallbackDurationInFrames: durationInFrames,
    sequenceDurationInFrames: durationInFrames,
  });
  const video = (
    <Video
      {...REMOTE_MEDIA_RENDER_PROPS}
      src={url}
      muted={muted}
      trimBefore={sourceRange.sourceStartFrame}
      trimAfter={sourceRange.sourceEndFrame}
      // En el Player, un hipo de reproduccion del avatar no debe tumbar el preview.
      onError={(err) => {
        console.warn("[Remotion preview] Avatar no reproducible:", url, err);
        return "fallback";
      }}
      style={{ width: "100%", height: "100%", objectFit }}
    />
  );

  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={sourceRange.sourceDurationInFrames}>
        {video}
      </Sequence>
      {sourceRange.tailFreezeInFrames > 0 ? (
        <Sequence
          from={sourceRange.sourceDurationInFrames}
          durationInFrames={sourceRange.tailFreezeInFrames}
        >
          <Freeze frame={sourceRange.sourceDurationInFrames - 1}>{video}</Freeze>
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
}

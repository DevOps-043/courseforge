import type { CSSProperties } from "react";
import { AbsoluteFill, OffthreadVideo, Series } from "remotion";
import type { AssemblyBrollClip } from "../types";
import type { LayoutOverrideStyle } from "../layout-override-styles";

interface BrollLayerProps {
  clips: AssemblyBrollClip[];
  style?: CSSProperties;
  getClipStyle?: (clip: AssemblyBrollClip) => LayoutOverrideStyle;
}

/**
 * Reproduce los clips de B-roll en secuencia, cada uno por su duración propia.
 * Va silenciado: el audio del ensamblado proviene de las pistas de voz/música.
 *
 * Degrada con gracia: 0 clips => no renderiza nada.
 */
export function BrollLayer({ clips, style, getClipStyle }: BrollLayerProps) {
  if (clips.length === 0) {
    return null;
  }

  const ordered = [...clips].sort((a, b) => a.order - b.order);

  return (
    <Series>
      {ordered.map((clip, i) => (
        <Series.Sequence
          key={`${clip.order}-${i}`}
          durationInFrames={clip.durationInFrames}
        >
          <AbsoluteFill
            style={{
              backgroundColor: "transparent",
              ...style,
              ...getClipStyle?.(clip),
            }}
          >
            <OffthreadVideo
              src={clip.url}
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </AbsoluteFill>
        </Series.Sequence>
      ))}
    </Series>
  );
}

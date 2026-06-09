import { AbsoluteFill } from "remotion";
import type { AssemblyBrollClip, AssemblySlide, AssemblyTransition } from "../types";
import { SlideShow } from "./SlideShow";
import { BrollLayer } from "./BrollLayer";

interface PrimaryVisualProps {
  slides: AssemblySlide[];
  brollClips: AssemblyBrollClip[];
  durationInFrames: number;
  transitionType: AssemblyTransition;
}

/** Fondo neutro cuando no hay ningún recurso visual que mostrar. */
function NeutralBackground() {
  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #151A21 0%, #0b0b0f 100%)",
      }}
    />
  );
}

/**
 * Resuelve el recurso visual principal con una prioridad estable:
 *   slides  ->  B-roll  ->  fondo neutro.
 *
 * Centraliza esa decisión para que las tres plantillas la compartan en lugar de
 * duplicar la lógica de fallback.
 */
export function PrimaryVisual({
  slides,
  brollClips,
  durationInFrames,
  transitionType,
}: PrimaryVisualProps) {
  if (slides.length > 0) {
    return (
      <SlideShow
        slides={slides}
        durationInFrames={durationInFrames}
        transitionType={transitionType}
      />
    );
  }

  if (brollClips.length > 0) {
    return <BrollLayer clips={brollClips} />;
  }

  return <NeutralBackground />;
}
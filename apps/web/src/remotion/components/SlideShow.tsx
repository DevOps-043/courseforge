import { ReactNode } from "react";
import { AbsoluteFill, Img, Series } from "remotion";
import {
  TransitionSeries,
  linearTiming,
} from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import type { AssemblySlide, AssemblyTransition } from "../types";

interface SlideShowProps {
  slides: AssemblySlide[];
  durationInFrames: number;
  transitionType: AssemblyTransition;
}

/** Tope de duración de transición; nunca debe igualar o exceder la slide. */
const MAX_TRANSITION_FRAMES = 15;

function SlideImage({ url }: { url: string }) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Img
        src={url}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </AbsoluteFill>
  );
}

/**
 * Reproduce las slides en orden, repartiendo `durationInFrames` de forma
 * equitativa. Con transición usa `@remotion/transitions`; sin ella, corte seco.
 *
 * Degrada con gracia: 0 slides => no renderiza nada (el caller decide el fondo).
 */
export function SlideShow({
  slides,
  durationInFrames,
  transitionType,
}: SlideShowProps) {
  if (slides.length === 0) {
    return null;
  }

  const ordered = [...slides].sort((a, b) => a.index - b.index);
  const slideCount = ordered.length;
  const perSlideFrames = Math.max(1, Math.floor(durationInFrames / slideCount));

  // Corte seco (o una sola slide): no hay transición que calcular.
  if (transitionType === "none" || slideCount === 1) {
    return (
      <Series>
        {ordered.map((s) => (
          <Series.Sequence key={s.index} durationInFrames={perSlideFrames}>
            <SlideImage url={s.url} />
          </Series.Sequence>
        ))}
      </Series>
    );
  }

  // La transición consume frames de solape; la mantenemos < perSlide para
  // evitar duraciones inválidas que Remotion rechazaría.
  const transitionFrames = Math.min(
    MAX_TRANSITION_FRAMES,
    Math.max(1, Math.floor(perSlideFrames / 2)),
  );
  const presentation = transitionType === "slide" ? slide() : fade();

  // TransitionSeries exige hijos planos alternando Sequence/Transition.
  const children: ReactNode[] = [];
  ordered.forEach((s, i) => {
    children.push(
      <TransitionSeries.Sequence
        key={`seq-${s.index}`}
        durationInFrames={perSlideFrames + transitionFrames}
      >
        <SlideImage url={s.url} />
      </TransitionSeries.Sequence>,
    );
    if (i < slideCount - 1) {
      children.push(
        <TransitionSeries.Transition
          key={`tr-${i}`}
          presentation={presentation}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />,
      );
    }
  });

  return <TransitionSeries>{children}</TransitionSeries>;
}
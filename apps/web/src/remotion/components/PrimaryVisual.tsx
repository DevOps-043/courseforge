import { AbsoluteFill } from "remotion";
import type {
  AssemblyBrollClip,
  AssemblySlide,
  AssemblyTransition,
} from "../types";
import { BrollLayer } from "./BrollLayer";
import { BrollOverlayLayer } from "./BrollOverlayLayer";
import { SlideShow } from "./SlideShow";

interface PrimaryVisualProps {
  slides: AssemblySlide[];
  brollClips: AssemblyBrollClip[];
  durationInFrames: number;
  transitionType: AssemblyTransition;
}

function NeutralBackground() {
  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #151A21 0%, #0b0b0f 100%)",
      }}
    />
  );
}

export function PrimaryVisual({
  slides,
  brollClips,
  durationInFrames,
  transitionType,
}: PrimaryVisualProps) {
  if (slides.length > 0) {
    return (
      <>
        <SlideShow
          slides={slides}
          durationInFrames={durationInFrames}
          transitionType={transitionType}
        />
        <BrollOverlayLayer
          clips={brollClips}
          durationInFrames={durationInFrames}
        />
      </>
    );
  }

  if (brollClips.length > 0) {
    return <BrollLayer clips={brollClips} />;
  }

  return <NeutralBackground />;
}

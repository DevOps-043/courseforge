import { AbsoluteFill } from "remotion";
import type {
  AssemblyBrollClip,
  AssemblySlide,
  AssemblyTransition,
} from "../types";
import {
  DEFAULT_TEMPLATE_RENDER_CONFIG,
  type TemplateRenderConfig,
} from "../template-config";
import { BrollLayer } from "./BrollLayer";
import { BrollOverlayLayer } from "./BrollOverlayLayer";
import { SlideShow } from "./SlideShow";

interface PrimaryVisualProps {
  slides: AssemblySlide[];
  brollClips: AssemblyBrollClip[];
  durationInFrames: number;
  transitionType: AssemblyTransition;
  templateConfig?: TemplateRenderConfig;
}

function NeutralBackground({
  templateConfig = DEFAULT_TEMPLATE_RENDER_CONFIG,
}: {
  templateConfig?: TemplateRenderConfig;
}) {
  const background =
    templateConfig.backgroundStyle === "solid"
      ? templateConfig.backgroundColor
      : `linear-gradient(135deg, ${templateConfig.surfaceColor} 0%, ${templateConfig.backgroundColor} 100%)`;

  return (
    <AbsoluteFill
      style={{
        background,
      }}
    />
  );
}

export function PrimaryVisual({
  slides,
  brollClips,
  durationInFrames,
  transitionType,
  templateConfig = DEFAULT_TEMPLATE_RENDER_CONFIG,
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

  return <NeutralBackground templateConfig={templateConfig} />;
}

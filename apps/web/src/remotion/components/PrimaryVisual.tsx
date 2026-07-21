import { AbsoluteFill } from "remotion";
import type {
  AssemblyBrollClip,
  AssemblySlide,
  AssemblyTransition,
} from "../types";
import type { LayoutOverrideStyle } from "../layout-override-styles";
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
  slidesLayerStyle?: LayoutOverrideStyle;
  brollLayerStyle?: LayoutOverrideStyle;
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
  slidesLayerStyle,
  brollLayerStyle,
}: PrimaryVisualProps) {
  if (slides.length > 0) {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, ...slidesLayerStyle }}>
          <SlideShow
            slides={slides}
            durationInFrames={durationInFrames}
            transitionType={transitionType}
          />
        </div>
        <BrollOverlayLayer
          clips={brollClips}
          durationInFrames={durationInFrames}
          containerStyle={brollLayerStyle}
        />
      </>
    );
  }

  if (brollClips.length > 0) {
    return (
      <div style={{ position: "absolute", inset: 0, ...brollLayerStyle }}>
        <BrollLayer clips={brollClips} />
      </div>
    );
  }

  return <NeutralBackground templateConfig={templateConfig} />;
}

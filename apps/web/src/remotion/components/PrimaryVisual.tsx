import { AbsoluteFill } from "remotion";
import type {
  AssemblyBrollClip,
  AssemblySlide,
  AssemblyTransition,
} from "../types";
import type { LayoutOverrideManifestList } from "../layout-overrides";
import {
  buildLayoutOverrideStyle,
  getBrollItemLayerId,
  getSlideItemLayerId,
  type LayoutOverrideStyle,
} from "../layout-override-styles";
import {
  DEFAULT_TEMPLATE_RENDER_CONFIG,
  type TemplateRenderConfig,
} from "../template-config";
import { BrollLayer } from "./BrollLayer";
import { BrollOverlayLayer } from "./BrollOverlayLayer";
import { SlideShow } from "./SlideShow";
import type { VisualTimelineSegment } from "../visual-timeline";

interface PrimaryVisualProps {
  slides: AssemblySlide[];
  brollClips: AssemblyBrollClip[];
  durationInFrames: number;
  transitionType: AssemblyTransition;
  templateConfig?: TemplateRenderConfig;
  layoutOverrides?: LayoutOverrideManifestList;
  timelineSegments?: VisualTimelineSegment[];
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
  layoutOverrides = [],
  timelineSegments = [],
  slidesLayerStyle,
  brollLayerStyle,
}: PrimaryVisualProps) {
  const slideTimelineSegments = timelineSegments.filter((segment) => segment.trackKind === "slides");
  const brollTimelineSegments = timelineSegments.filter((segment) => segment.trackKind === "broll");

  if (slides.length > 0) {
    return (
      <>
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            ...slidesLayerStyle,
          }}
        >
          <SlideShow
            slides={slides}
            durationInFrames={durationInFrames}
            transitionType={transitionType}
            segments={slideTimelineSegments}
            getSlideStyle={(slide) =>
              buildLayoutOverrideStyle(
                layoutOverrides,
                getSlideItemLayerId(slide.index),
              )
            }
          />
        </div>
        <BrollOverlayLayer
          clips={brollClips}
          durationInFrames={durationInFrames}
          segments={brollTimelineSegments}
          containerStyle={{ zIndex: 20, ...brollLayerStyle }}
          getClipStyle={(clip) =>
            buildLayoutOverrideStyle(
              layoutOverrides,
              getBrollItemLayerId(clip.order),
            )
          }
        />
      </>
    );
  }

  if (brollClips.length > 0) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 20,
          ...brollLayerStyle,
        }}
      >
        <BrollLayer
          clips={brollClips}
          segments={brollTimelineSegments}
          getClipStyle={(clip) =>
            buildLayoutOverrideStyle(
              layoutOverrides,
              getBrollItemLayerId(clip.order),
            )
          }
        />
      </div>
    );
  }

  return <NeutralBackground templateConfig={templateConfig} />;
}

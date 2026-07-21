import type { BundleBlueprint, LayerBox } from "./blueprint.service";

function json(value: unknown) {
  return JSON.stringify(value);
}

function boxLiteral(box: LayerBox) {
  return `{ x: ${box.x}, y: ${box.y}, width: ${box.width}, height: ${box.height} }`;
}

export function buildBundleTemplateSource(blueprint: BundleBlueprint) {
  return `import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  Video,
  interpolate,
  registerRoot,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";

type SlideAsset = {
  index?: number;
  url: string;
};

type BrollClip = {
  durationInFrames?: number;
  order?: number;
  url: string;
};

type LayoutOverrideEdit =
  | { layerId: string; kind: "position"; x: number; y: number }
  | { layerId: string; kind: "size"; width: number; height: number }
  | { layerId: string; kind: "crop"; top: number; right: number; bottom: number; left: number }
  | { layerId: string; kind: "rotation"; angle: number }
  | { layerId: string; kind: "visibility"; hidden: boolean };

type LayoutOverrideManifest = {
  version?: number;
  canvas?: {
    width?: number;
    height?: number;
    fps?: number;
  };
  edits?: LayoutOverrideEdit[];
};

type TemplateProps = {
  accentColor?: string;
  avatarVideoUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  brollClips?: BrollClip[];
  layoutOverrides?: LayoutOverrideManifest[];
  slides?: SlideAsset[];
  totalDurationInFrames?: number;
  voiceAudioUrl?: string;
};

const compositionId = ${json(blueprint.compositionId)};
const compositionWidth = ${blueprint.width};
const compositionHeight = ${blueprint.height};
const fallbackFps = ${blueprint.fps};
const fallbackDurationInFrames = ${blueprint.fallbackDurationFrames};
const accentColor = ${json(blueprint.accentColor)};
const layoutMode = ${json(blueprint.layout)};
const timelineMode = ${json(blueprint.timeline)};
const renderText = ${blueprint.renderText ? "true" : "false"};
const avatarBox = ${boxLiteral(blueprint.boxes.avatar)};
const primaryVisualBox = ${boxLiteral(blueprint.boxes.primaryVisual)};
const slidesBox = ${boxLiteral(blueprint.boxes.slides)};
const brollBox = ${boxLiteral(blueprint.boxes.broll)};
const defaultProps: TemplateProps = {
  accentColor,
  bgMusicVolume: 0.12,
  brollClips: [],
  layoutOverrides: [],
  slides: [],
  totalDurationInFrames: fallbackDurationInFrames,
};

const REMOTION_EDITABLE_LAYERS = {
  AVATAR: "avatar",
  PRIMARY_VISUAL: "primaryVisual",
  SLIDES: "slides",
  BROLL: "broll",
  BACKGROUND: "background",
} as const;

function orderedSlides(slides: SlideAsset[] = []) {
  return slides
    .filter((slide) => typeof slide.url === "string" && slide.url.length > 0)
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
}

function orderedBrollClips(clips: BrollClip[] = []) {
  return clips
    .filter((clip) => typeof clip.url === "string" && clip.url.length > 0)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

function getLayerEdits(
  manifests: LayoutOverrideManifest[] | null | undefined,
  layerId: string,
): LayoutOverrideEdit[] {
  if (!Array.isArray(manifests)) return [];

  return manifests.flatMap((manifest) => {
    if (!Array.isArray(manifest.edits)) return [];
    return manifest.edits.filter((edit) => edit.layerId === layerId);
  });
}

function formatCropInset(value: number) {
  const bounded = Math.min(1, Math.max(0, value));
  return \`\${Math.round(bounded * 10000) / 100}%\`;
}

function buildLayoutOverrideStyle(
  manifests: LayoutOverrideManifest[] | null | undefined,
  layerId: string,
): React.CSSProperties {
  const edits = getLayerEdits(manifests, layerId);
  if (edits.length === 0) return {};

  const style = {} as React.CSSProperties & { rotate?: string };

  for (const edit of edits) {
    if (edit.kind === "position") {
      style.position = "absolute";
      style.left = edit.x;
      style.top = edit.y;
      style.right = "auto";
      style.bottom = "auto";
      style.flex = "none";
    }

    if (edit.kind === "size") {
      style.width = edit.width;
      style.height = edit.height;
      style.flex = "none";
    }

    if (edit.kind === "crop") {
      style.clipPath = \`inset(\${formatCropInset(edit.top)} \${formatCropInset(edit.right)} \${formatCropInset(edit.bottom)} \${formatCropInset(edit.left)})\`;
    }

    if (edit.kind === "rotation") {
      style.rotate = \`\${edit.angle}deg\`;
    }

    if (edit.kind === "visibility" && edit.hidden) {
      style.display = "none";
    }
  }

  return style;
}

function getActiveIndex(frame: number, itemCount: number, durationInFrames: number) {
  if (itemCount <= 0) return -1;
  const framesPerItem = durationInFrames / itemCount;
  return Math.min(itemCount - 1, Math.floor(frame / Math.max(1, framesPerItem)));
}

function buildBoxStyle(box: { x: number; y: number; width: number; height: number }, overrides: React.CSSProperties = {}): React.CSSProperties {
  return {
    position: "absolute",
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    overflow: "hidden",
    ...overrides,
  };
}

export const calculateMetadata: CalculateMetadataFunction<TemplateProps> = async ({ props }) => {
  const durationFromProps =
    typeof props.totalDurationInFrames === "number" && Number.isFinite(props.totalDurationInFrames)
      ? Math.max(1, Math.round(props.totalDurationInFrames))
      : null;

  return {
    durationInFrames: durationFromProps || fallbackDurationInFrames,
    fps: fallbackFps,
    props,
  };
};

export function CourseforgeGeneratedBundle(props: TemplateProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const slides = orderedSlides(props.slides);
  const brollClips = orderedBrollClips(props.brollClips);
  const activeSlideIndex = getActiveIndex(frame, slides.length, durationInFrames);
  const activeSupportIndex = getActiveIndex(frame, Math.max(slides.length, brollClips.length), durationInFrames);
  const activeSlide = activeSlideIndex >= 0 ? slides[activeSlideIndex] : null;
  const activeBroll = timelineMode === "equal-slides-with-indexed-broll"
    ? activeSlideIndex >= 0 ? brollClips[activeSlideIndex] ?? null : null
    : activeSupportIndex >= 0 ? brollClips[activeSupportIndex] ?? null : null;
  const hasVoice = typeof props.voiceAudioUrl === "string" && props.voiceAudioUrl.length > 0;
  const hasAvatar = typeof props.avatarVideoUrl === "string" && props.avatarVideoUrl.length > 0;
  const slideLocalFrame = frame % Math.max(1, durationInFrames / Math.max(1, slides.length));
  const slideOpacity = interpolate(slideLocalFrame, [0, 10], [0.74, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const avatarOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.AVATAR);
  const primaryVisualOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL);
  const slidesOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.SLIDES);
  const brollOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.BROLL);
  const backgroundOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.BACKGROUND);

  return (
    <AbsoluteFill
      style={{
        background: "#05070b",
        fontFamily: "Inter, Arial, sans-serif",
        overflow: "hidden",
        ...backgroundOverride,
      }}
    >
      <div style={buildBoxStyle(primaryVisualBox, { background: "#090d14", ...primaryVisualOverride })} />

      {hasAvatar ? (
        <div style={buildBoxStyle(avatarBox, { background: "#05070b", ...avatarOverride })}>
          <Video
            src={props.avatarVideoUrl!}
            muted={hasVoice}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" }}
          />
        </div>
      ) : null}

      {activeSlide ? (
        <div style={buildBoxStyle(slidesBox, { opacity: slideOpacity, ...slidesOverride })}>
          <Img
            src={activeSlide.url}
            style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center center" }}
          />
        </div>
      ) : null}

      {activeBroll ? (
        <div style={buildBoxStyle(brollBox, { background: "#000", ...brollOverride })}>
          <Video
            src={activeBroll.url}
            muted
            loop
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" }}
          />
        </div>
      ) : null}

      {renderText && layoutMode !== "avatar-left-slides-broll-right" ? (
        <div
          style={{
            position: "absolute",
            left: 56,
            bottom: 44,
            width: 220,
            height: 8,
            background: props.accentColor || accentColor,
            opacity: 0.92,
          }}
        />
      ) : null}

      {hasVoice ? <Audio src={props.voiceAudioUrl!} /> : null}
      {props.bgMusicUrl ? <Audio src={props.bgMusicUrl} volume={props.bgMusicVolume ?? 0.12} /> : null}
    </AbsoluteFill>
  );
}

function RemotionRoot() {
  return (
    <Composition
      id={compositionId}
      component={CourseforgeGeneratedBundle}
      durationInFrames={fallbackDurationInFrames}
      fps={fallbackFps}
      width={compositionWidth}
      height={compositionHeight}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  );
}

registerRoot(RemotionRoot);
`;
}

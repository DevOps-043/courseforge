import type { BundleBlueprint, LayerBox } from "./blueprint.service";

function json(value: unknown) {
  return JSON.stringify(value);
}

function boxLiteral(box: LayerBox) {
  return `{ x: ${box.x}, y: ${box.y}, width: ${box.width}, height: ${box.height} }`;
}

function defaultStackOrder(blueprint: BundleBlueprint, layerId: string, fallback: number) {
  return blueprint.editableLayers.find((layer) => layer.layerId === layerId)?.defaultStackOrder ?? fallback;
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

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayoutOverrideEdit =
  | { layerId: string; kind: "position"; x: number; y: number }
  | { layerId: string; kind: "size"; width: number; height: number }
  | { layerId: string; kind: "crop"; top: number; right: number; bottom: number; left: number }
  | { layerId: string; kind: "rotation"; angle: number }
  | { layerId: string; kind: "visibility"; hidden: boolean }
  | { layerId: string; kind: "stack"; order: number };

type LayoutOverrideManifest = {
  version?: number;
  canvas?: {
    width?: number;
    height?: number;
    fps?: number;
  };
  edits?: LayoutOverrideEdit[];
};

type DesignTokens = {
  accentColor?: string;
  backgroundColor?: string;
  mutedTextColor?: string;
  surfaceColor?: string;
  textColor?: string;
  typographyBody?: string;
  typographyDisplay?: string;
};

type TemplateProps = {
  accentColor?: string;
  animationVariant?: string;
  avatarVideoUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  brollClips?: BrollClip[];
  designTokens?: DesignTokens;
  expandMissingSupportMedia?: boolean;
  layoutOverrides?: LayoutOverrideManifest[];
  sceneSwapOnSlideChange?: boolean;
  slides?: SlideAsset[];
  totalDurationInFrames?: number;
  visualVariantId?: string;
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
const isReferenceFrameLayout = layoutMode === "reference-frame-avatar-left-stack-right";
const avatarBox = ${boxLiteral(blueprint.boxes.avatar)};
const primaryVisualBox = ${boxLiteral(blueprint.boxes.primaryVisual)};
const slidesBox = ${boxLiteral(blueprint.boxes.slides)};
const brollBox = ${boxLiteral(blueprint.boxes.broll)};
const defaultStackOrders = {
  avatar: ${defaultStackOrder(blueprint, "avatar", 10)},
  primaryVisual: ${defaultStackOrder(blueprint, "primaryVisual", 0)},
  slides: ${defaultStackOrder(blueprint, "slides", 20)},
  broll: ${defaultStackOrder(blueprint, "broll", 30)},
} as const;
const defaultProps: TemplateProps = {
  accentColor,
  animationVariant: "measured",
  bgMusicVolume: 0.12,
  brollClips: [],
  designTokens: {
    accentColor,
    backgroundColor: "#05070b",
    surfaceColor: "#090d14",
    textColor: "#f8fafc",
    mutedTextColor: "#cbd5e1",
    typographyBody: "Inter, Arial, sans-serif",
    typographyDisplay: "Inter, Arial, sans-serif",
  },
  expandMissingSupportMedia: false,
  layoutOverrides: [],
  sceneSwapOnSlideChange: false,
  slides: [],
  totalDurationInFrames: fallbackDurationInFrames,
  visualVariantId: "variant-studio-asymmetric",
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

    if (edit.kind === "stack") {
      style.zIndex = edit.order;
    }
  }

  return style;
}

function getActiveIndex(frame: number, itemCount: number, durationInFrames: number) {
  if (itemCount <= 0) return -1;
  const framesPerItem = durationInFrames / itemCount;
  return Math.min(itemCount - 1, Math.floor(frame / Math.max(1, framesPerItem)));
}

function mirrorBoxHorizontally(box: Box): Box {
  return {
    ...box,
    x: compositionWidth - box.x - box.width,
  };
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function lerpBox(from: Box, to: Box, progress: number): Box {
  return {
    x: Math.round(lerp(from.x, to.x, progress)),
    y: Math.round(lerp(from.y, to.y, progress)),
    width: Math.round(lerp(from.width, to.width, progress)),
    height: Math.round(lerp(from.height, to.height, progress)),
  };
}

function unionBoxes(first: Box, second: Box): Box {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function buildSceneBox(baseBox: Box, sceneMirrored: boolean, previousSceneMirrored: boolean, progress: number): Box {
  const from = previousSceneMirrored ? mirrorBoxHorizontally(baseBox) : baseBox;
  const to = sceneMirrored ? mirrorBoxHorizontally(baseBox) : baseBox;

  return lerpBox(from, to, progress);
}

function buildBoxStyle(box: Box, overrides: React.CSSProperties = {}): React.CSSProperties {
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
  const activeBrollIndex = brollClips.length <= 0
    ? -1
    : timelineMode === "equal-slides-with-indexed-broll"
      ? slides.length > 0
        ? activeSlideIndex >= 0 ? Math.min(brollClips.length - 1, activeSlideIndex) : -1
        : activeSupportIndex
      : activeSupportIndex;
  const activeBroll = activeBrollIndex >= 0 ? brollClips[activeBrollIndex] ?? null : null;
  const hasVoice = typeof props.voiceAudioUrl === "string" && props.voiceAudioUrl.length > 0;
  const hasAvatar = typeof props.avatarVideoUrl === "string" && props.avatarVideoUrl.length > 0;
  const hasSlidesAsset = slides.length > 0;
  const hasBrollAsset = brollClips.length > 0;
  const sceneItemCount = Math.max(1, slides.length, brollClips.length);
  const sceneIndex = Math.max(0, activeSlideIndex >= 0 ? activeSlideIndex : activeSupportIndex >= 0 ? activeSupportIndex : 0);
  const framesPerScene = durationInFrames / sceneItemCount;
  const sceneLocalFrame = frame % Math.max(1, framesPerScene);
  const sceneTransitionFrames = Math.min(18, Math.max(1, framesPerScene * 0.24));
  const sceneProgress = props.sceneSwapOnSlideChange
    ? interpolate(sceneLocalFrame, [0, sceneTransitionFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 1;
  const sceneMirrored = Boolean(props.sceneSwapOnSlideChange) && sceneIndex % 2 === 1;
  const previousSceneMirrored = Boolean(props.sceneSwapOnSlideChange) && sceneIndex > 0 && (sceneIndex - 1) % 2 === 1;
  const supportUnionBox = unionBoxes(slidesBox, brollBox);
  const shouldExpandSupport = props.expandMissingSupportMedia === true;
  const effectiveSlidesBox = shouldExpandSupport && hasSlidesAsset && !hasBrollAsset ? supportUnionBox : slidesBox;
  const effectiveBrollBox = shouldExpandSupport && hasBrollAsset && !hasSlidesAsset ? supportUnionBox : brollBox;
  const avatarSceneBox = buildSceneBox(avatarBox, sceneMirrored, previousSceneMirrored, sceneProgress);
  const slidesSceneBox = buildSceneBox(effectiveSlidesBox, sceneMirrored, previousSceneMirrored, sceneProgress);
  const brollSceneBox = buildSceneBox(effectiveBrollBox, sceneMirrored, previousSceneMirrored, sceneProgress);
  const slideLocalFrame = frame % Math.max(1, durationInFrames / Math.max(1, slides.length));
  const slideOpacity = interpolate(slideLocalFrame, [0, 10], [0.74, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const tokenAccent = props.designTokens?.accentColor || props.accentColor || accentColor;
  const tokenBackground = props.designTokens?.backgroundColor || "#05070b";
  const tokenSurface = props.designTokens?.surfaceColor || "#090d14";
  const tokenBodyFont = props.designTokens?.typographyBody || "Inter, Arial, sans-serif";

  const avatarOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.AVATAR);
  const primaryVisualOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL);
  const slidesOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.SLIDES);
  const brollOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.BROLL);
  const backgroundOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.BACKGROUND);
  const activeSlideItemOverride = activeSlideIndex >= 0
    ? buildLayoutOverrideStyle(props.layoutOverrides, \`slide:\${activeSlideIndex}\`)
    : {};
  const activeBrollItemOverride = activeBroll
    ? buildLayoutOverrideStyle(
        props.layoutOverrides,
        \`broll:\${Math.max(1, Math.round(activeBroll.order ?? activeBrollIndex + 1))}\`,
      )
    : {};

  return (
    <AbsoluteFill
      style={{
        background: tokenBackground,
        fontFamily: tokenBodyFont,
        overflow: "hidden",
        ...backgroundOverride,
      }}
    >
      <div style={buildBoxStyle(primaryVisualBox, { background: isReferenceFrameLayout ? "transparent" : tokenSurface, zIndex: defaultStackOrders.primaryVisual, ...primaryVisualOverride })} />

      {hasAvatar ? (
        <div style={buildBoxStyle(avatarSceneBox, { background: isReferenceFrameLayout ? tokenSurface : "transparent", zIndex: defaultStackOrders.avatar, ...avatarOverride })}>
          <Video
            src={props.avatarVideoUrl!}
            muted={hasVoice}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" }}
          />
        </div>
      ) : null}

      {activeSlide ? (
        <div style={buildBoxStyle(slidesSceneBox, { background: tokenSurface, opacity: slideOpacity, zIndex: defaultStackOrders.slides, ...slidesOverride, ...activeSlideItemOverride })}>
          <Img
            src={activeSlide.url}
            style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center center" }}
          />
        </div>
      ) : null}

      {activeBroll ? (
        <div style={buildBoxStyle(brollSceneBox, { background: isReferenceFrameLayout ? tokenSurface : "transparent", zIndex: defaultStackOrders.broll, ...brollOverride, ...activeBrollItemOverride })}>
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
            background: tokenAccent,
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

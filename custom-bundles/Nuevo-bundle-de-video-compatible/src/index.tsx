import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Freeze,
  Img,
  Loop,
  OffthreadVideo,
  Sequence,
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

type AvatarClip = {
  durationInFrames?: number;
  order?: number;
  url: string;
};

type TimelineOverrideSegment = {
  id?: string;
  trackKind?: "slides" | "broll";
  layerId?: string;
  startFrame?: number;
  endFrame?: number;
  sourceStartFrame?: number;
  sourceEndFrame?: number;
  loopMode?: "loop" | "freeze" | "none";
};

type TimelineOverrideManifest = {
  version?: number;
  templateId?: string;
  templateVersionId?: string | null;
  componentId?: string;
  timeline?: {
    durationInFrames?: number;
    fps?: number;
  };
  segments?: TimelineOverrideSegment[];
};

type SlideTimelineItem = {
  slide: SlideAsset;
  startFrame: number;
  durationInFrames: number;
  id: string;
  layerId: string;
  index: number;
};

type BrollTimelineItem = {
  clip: BrollClip;
  startFrame: number;
  durationInFrames: number;
  id: string;
  layerId: string;
  sourceStartFrame?: number;
  sourceEndFrame?: number;
  loopMode?: "loop" | "freeze" | "none";
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
  avatarClips?: AvatarClip[];
  avatarVideoUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  brollClips?: BrollClip[];
  designTokens?: DesignTokens;
  expandMissingSupportMedia?: boolean;
  layoutOverrides?: LayoutOverrideManifest[];
  sceneSwapOnSlideChange?: boolean;
  slides?: SlideAsset[];
  timelineOverrides?: TimelineOverrideManifest[];
  totalDurationInFrames?: number;
  visualVariantId?: string;
  voiceAudioUrl?: string;
};

const compositionId = "Nuevo-bundle-de-video";
const compositionWidth = 1920;
const compositionHeight = 1080;
const fallbackFps = 30;
const fallbackDurationInFrames = 150;
const accentColor = "#DA951C";
const layoutMode: string = "stacked-support";
const timelineMode: string = "equal-support-visuals";
const renderText = false;
const isReferenceFrameLayout = layoutMode === "reference-frame-avatar-left-stack-right";
const avatarBox = { x: 0, y: 0, width: 691, height: 1080 };
const primaryVisualBox = { x: 691, y: 0, width: 1229, height: 1080 };
const slidesBox = { x: 733, y: 42, width: 1145, height: 477 };
const brollBox = { x: 733, y: 561, width: 1145, height: 477 };
const defaultStackOrders = {
  avatar: 10,
  primaryVisual: 0,
  slides: 20,
  broll: 30,
} as const;
const defaultProps: TemplateProps = {
  accentColor,
  animationVariant: "measured",
  avatarClips: [],
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
  timelineOverrides: [],
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

function orderedAvatarClips(clips: AvatarClip[] = []) {
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
  return `${Math.round(bounded * 10000) / 100}%`;
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
      style.clipPath = `inset(${formatCropInset(edit.top)} ${formatCropInset(edit.right)} ${formatCropInset(edit.bottom)} ${formatCropInset(edit.left)})`;
    }

    if (edit.kind === "rotation") {
      style.rotate = `${edit.angle}deg`;
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

function clampFrame(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeItemIndex(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}

function normalizeClipOrder(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.round(value)) : fallback;
}

function normalizeOptionalFrame(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
}

function getTimelineOverrideSegments(
  manifests: TimelineOverrideManifest[] | null | undefined,
  trackKind: "slides" | "broll",
): TimelineOverrideSegment[] {
  if (!Array.isArray(manifests)) return [];

  return manifests.flatMap((manifest) => {
    if (!Array.isArray(manifest.segments)) return [];
    return manifest.segments.filter((segment) => segment.trackKind === trackKind);
  });
}

function findTimelineOverrideSegment(
  segments: TimelineOverrideSegment[],
  item: { id: string; layerId: string },
) {
  return segments.find((segment) => segment.id === item.id || segment.layerId === item.layerId) ?? null;
}

function resolveOverrideWindow(segment: TimelineOverrideSegment, durationInFrames: number) {
  const boundedDuration = Math.max(1, Math.round(durationInFrames));
  const rawStartFrame = typeof segment.startFrame === "number" && Number.isFinite(segment.startFrame) ? segment.startFrame : 0;
  const rawEndFrame = typeof segment.endFrame === "number" && Number.isFinite(segment.endFrame) ? segment.endFrame : rawStartFrame + 1;
  const startFrame = clampFrame(rawStartFrame, 0, Math.max(0, boundedDuration - 1));
  const endFrame = clampFrame(rawEndFrame, startFrame + 1, boundedDuration);

  return {
    startFrame,
    durationInFrames: endFrame - startFrame,
  };
}

function getClipDurationInFrames(clip: BrollClip) {
  return typeof clip.durationInFrames === "number" && Number.isFinite(clip.durationInFrames)
    ? Math.max(1, Math.round(clip.durationInFrames))
    : 150;
}

function buildAvatarTimeline(clips: AvatarClip[], totalDurationInFrames: number) {
  let cursor = 0;
  return clips.flatMap((clip, index) => {
    if (cursor >= totalDurationInFrames) return [];
    const clipDurationInFrames = getClipDurationInFrames(clip);
    const remainingFrames = totalDurationInFrames - cursor;
    const durationInFrames = index === clips.length - 1
      ? remainingFrames
      : Math.min(clipDurationInFrames, remainingFrames);
    const item = {
      clip,
      startFrame: cursor,
      durationInFrames: Math.max(1, durationInFrames),
      sourceDurationInFrames: clipDurationInFrames,
    };
    cursor += Math.min(clipDurationInFrames, remainingFrames);
    return [item];
  });
}

function SafeRenderVideo({
  src,
  muted,
  durationInFrames,
  sourceStartFrame = 0,
  sourceEndFrame,
  loop = false,
  style,
}: {
  src: string;
  muted: boolean;
  durationInFrames: number;
  sourceStartFrame?: number;
  sourceEndFrame?: number;
  loop?: boolean;
  style: React.CSSProperties;
}) {
  const requestedEndFrame = Math.max(
    sourceStartFrame + 1,
    sourceEndFrame ?? sourceStartFrame + durationInFrames,
  );
  const safeEndFrame = requestedEndFrame - sourceStartFrame > 16
    ? requestedEndFrame - 15
    : requestedEndFrame;
  const sourceDurationInFrames = Math.max(1, safeEndFrame - sourceStartFrame);
  const video = (
    <OffthreadVideo
      src={src}
      muted={muted}
      startFrom={sourceStartFrame}
      endAt={safeEndFrame}
      delayRenderTimeoutInMilliseconds={45_000}
      delayRenderRetries={1}
      style={style}
    />
  );

  if (loop) {
    return <Loop durationInFrames={sourceDurationInFrames}>{video}</Loop>;
  }

  return (
    <>
      <Sequence from={0} durationInFrames={sourceDurationInFrames}>{video}</Sequence>
      {durationInFrames > sourceDurationInFrames ? (
        <Sequence from={sourceDurationInFrames} durationInFrames={durationInFrames - sourceDurationInFrames}>
          <Freeze frame={sourceDurationInFrames - 1}>{video}</Freeze>
        </Sequence>
      ) : null}
    </>
  );
}

function buildSlideTimeline(
  slides: SlideAsset[],
  durationInFrames: number,
  timelineOverrides: TimelineOverrideManifest[] | null | undefined,
): SlideTimelineItem[] {
  if (slides.length === 0 || durationInFrames <= 0) return [];

  const ordered = orderedSlides(slides);
  const segments = getTimelineOverrideSegments(timelineOverrides, "slides");
  const framesPerSlide = durationInFrames / ordered.length;

  return ordered.map((slide, position) => {
    const startFrame = Math.floor(position * framesPerSlide);
    const endFrame = position === ordered.length - 1 ? durationInFrames : Math.floor((position + 1) * framesPerSlide);
    const index = normalizeItemIndex(slide.index, position);
    const item: SlideTimelineItem = {
      slide,
      startFrame,
      durationInFrames: Math.max(1, endFrame - startFrame),
      id: `slide-${index}`,
      layerId: `slide:${index}`,
      index,
    };
    const override = findTimelineOverrideSegment(segments, item);

    return override ? { ...item, ...resolveOverrideWindow(override, durationInFrames) } : item;
  }).filter((item) => item.durationInFrames > 0);
}

function buildBrollTimeline(
  clips: BrollClip[],
  durationInFrames: number,
  timelineOverrides: TimelineOverrideManifest[] | null | undefined,
): BrollTimelineItem[] {
  if (clips.length === 0 || durationInFrames <= 0) return [];

  const ordered = orderedBrollClips(clips);
  const segments = getTimelineOverrideSegments(timelineOverrides, "broll");
  const supportCount = Math.max(1, ordered.length);
  const framesPerItem = durationInFrames / supportCount;

  return ordered.map((clip, position) => {
    const order = normalizeClipOrder(clip.order, position + 1);
    const startFrame = Math.floor(position * framesPerItem);
    const baselineDuration = timelineMode === "equal-support-visuals"
      ? Math.max(1, Math.floor((position === ordered.length - 1 ? durationInFrames : Math.floor((position + 1) * framesPerItem)) - startFrame))
      : Math.min(getClipDurationInFrames(clip), Math.max(1, durationInFrames - startFrame));
    const item: BrollTimelineItem = {
      clip,
      startFrame,
      durationInFrames: baselineDuration,
      id: `broll-${order}`,
      layerId: `broll:${order}`,
    };
    const override = findTimelineOverrideSegment(segments, item);

    return override
      ? {
        ...item,
        ...resolveOverrideWindow(override, durationInFrames),
        sourceStartFrame: normalizeOptionalFrame(override.sourceStartFrame),
        sourceEndFrame: normalizeOptionalFrame(override.sourceEndFrame),
        loopMode: override.loopMode,
      }
      : item;
  }).filter((item) => item.durationInFrames > 0);
}

function getActiveSlideTimelineItem(frame: number, timeline: SlideTimelineItem[]) {
  return timeline.find((item) => frame >= item.startFrame && frame < item.startFrame + item.durationInFrames) ?? null;
}

function getActiveBrollTimelineItem(frame: number, timeline: BrollTimelineItem[]) {
  return timeline.find((item) => frame >= item.startFrame && frame < item.startFrame + item.durationInFrames) ?? null;
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
  const avatarClips = orderedAvatarClips(props.avatarClips);
  const avatarTimeline = buildAvatarTimeline(avatarClips, durationInFrames);
  const slides = orderedSlides(props.slides);
  const brollClips = orderedBrollClips(props.brollClips);
  const slideTimeline = buildSlideTimeline(slides, durationInFrames, props.timelineOverrides);
  const brollTimeline = buildBrollTimeline(brollClips, durationInFrames, props.timelineOverrides);
  const activeSlideItem = getActiveSlideTimelineItem(frame, slideTimeline);
  const activeBrollItem = getActiveBrollTimelineItem(frame, brollTimeline);
  const activeSlideIndex = activeSlideItem?.index ?? -1;
  const activeSupportIndex = getActiveIndex(frame, Math.max(slides.length, brollClips.length), durationInFrames);
  const activeSlide = activeSlideItem?.slide ?? null;
  const activeBroll = activeBrollItem?.clip ?? null;
  const hasVoice = typeof props.voiceAudioUrl === "string" && props.voiceAudioUrl.length > 0;
  const hasAvatarVideo = typeof props.avatarVideoUrl === "string" && props.avatarVideoUrl.length > 0;
  const hasAvatar = avatarTimeline.length > 0 || hasAvatarVideo;
  const hasSlidesAsset = slides.length > 0;
  const hasBrollAsset = brollClips.length > 0;
  const sceneItemCount = Math.max(1, slides.length, brollClips.length);
  const activeBrollIndex = activeBrollItem ? Math.max(0, normalizeClipOrder(activeBrollItem.clip.order, 1) - 1) : -1;
  const sceneIndex = Math.max(0, activeSlideIndex >= 0 ? activeSlideIndex : activeBrollIndex >= 0 ? activeBrollIndex : activeSupportIndex >= 0 ? activeSupportIndex : 0);
  const framesPerScene = durationInFrames / sceneItemCount;
  const activeSceneStartFrame = activeSlideItem?.startFrame ?? activeBrollItem?.startFrame ?? 0;
  const sceneLocalFrame = Math.max(0, frame - activeSceneStartFrame);
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
  const slideLocalFrame = activeSlideItem ? Math.max(0, frame - activeSlideItem.startFrame) : 0;
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
  const activeSlideItemOverride = activeSlideItem
    ? buildLayoutOverrideStyle(props.layoutOverrides, activeSlideItem.layerId)
    : {};
  const activeBrollItemOverride = activeBrollItem
    ? buildLayoutOverrideStyle(props.layoutOverrides, activeBrollItem.layerId)
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
          {avatarTimeline.length > 0 ? avatarTimeline.map((item, index) => (
            <Sequence
              key={`${item.clip.order ?? index + 1}-${index}`}
              from={item.startFrame}
              durationInFrames={item.durationInFrames}
            >
              <SafeRenderVideo
                src={item.clip.url}
                muted={hasVoice}
                durationInFrames={item.durationInFrames}
                sourceEndFrame={item.sourceDurationInFrames}
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" }}
              />
            </Sequence>
          )) : (
            <SafeRenderVideo
              src={props.avatarVideoUrl!}
              muted={hasVoice}
              durationInFrames={durationInFrames}
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" }}
            />
          )}
        </div>
      ) : null}

      {activeSlide && activeSlideItem ? (
        <Sequence from={activeSlideItem.startFrame} durationInFrames={activeSlideItem.durationInFrames}>
          <div style={buildBoxStyle(slidesSceneBox, { background: tokenSurface, opacity: slideOpacity, zIndex: defaultStackOrders.slides, ...slidesOverride, ...activeSlideItemOverride })}>
            <Img
              src={activeSlide.url}
              style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center center" }}
            />
          </div>
        </Sequence>
      ) : null}

      {activeBroll && activeBrollItem ? (
        <Sequence from={activeBrollItem.startFrame} durationInFrames={activeBrollItem.durationInFrames}>
          <div style={buildBoxStyle(brollSceneBox, { background: isReferenceFrameLayout ? tokenSurface : "transparent", zIndex: defaultStackOrders.broll, ...brollOverride, ...activeBrollItemOverride })}>
            <SafeRenderVideo
              src={activeBroll.url}
              muted
              durationInFrames={activeBrollItem.durationInFrames}
              loop={activeBrollItem.loopMode !== "none"}
              sourceStartFrame={activeBrollItem.sourceStartFrame}
              sourceEndFrame={activeBrollItem.sourceEndFrame ?? getClipDurationInFrames(activeBroll)}
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" }}
            />
          </div>
        </Sequence>
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

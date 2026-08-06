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

type TemplateProps = {
  avatarVideoUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  brollClips?: BrollClip[];
  layoutOverrides?: LayoutOverrideManifest[];
  slides?: SlideAsset[];
  timelineOverrides?: TimelineOverrideManifest[];
  totalDurationInFrames?: number;
  voiceAudioUrl?: string;
};

const fallbackDurationInFrames = 1800;
const fallbackFps = 30;
const compositionWidth = 1920;
const compositionHeight = 1080;
const compositionId = "avatar-left-slides-broll-right";
const avatarBox = { x: 0, y: 0, width: 806, height: 1080 };
const primaryVisualBox = { x: 806, y: 0, width: 1114, height: 1080 };
const slidesBox = { x: 842, y: 36, width: 1042, height: 626 };
const brollBox = { x: 1364, y: 752, width: 520, height: 292 };
const defaultStackOrders = {
  avatar: 10,
  primaryVisual: 0,
  slides: 20,
  broll: 30,
} as const;
const defaultProps: TemplateProps = {
  avatarVideoUrl: "",
  bgMusicUrl: "",
  bgMusicVolume: 0.12,
  brollClips: [],
  layoutOverrides: [],
  slides: [],
  timelineOverrides: [],
  totalDurationInFrames: fallbackDurationInFrames,
  voiceAudioUrl: "",
};

const REMOTION_EDITABLE_LAYERS = {
  AVATAR: "avatar",
  SLIDES: "slides",
  BROLL: "broll",
  PRIMARY_VISUAL: "primaryVisual",
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

function clampFrame(value: number, min: number, max: number) {
  const rounded = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, rounded));
}

function normalizeItemIndex(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}

function normalizeClipOrder(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.round(value))
    : fallback;
}

function normalizeOptionalFrame(value: unknown) {
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

function getClipDurationInFrames(clip: BrollClip) {
  return typeof clip.durationInFrames === "number" && Number.isFinite(clip.durationInFrames)
    ? Math.max(1, Math.round(clip.durationInFrames))
    : 150;
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

function buildBrollTimeline(
  clips: BrollClip[],
  durationInFrames: number,
  timelineOverrides: TimelineOverrideManifest[] | null | undefined,
): BrollTimelineItem[] {
  if (clips.length === 0 || durationInFrames <= 0) return [];

  const ordered = orderedBrollClips(clips);
  const segments = getTimelineOverrideSegments(timelineOverrides, "broll");
  const framesPerItem = durationInFrames / Math.max(1, ordered.length);

  return ordered.map((clip, position) => {
    const startFrame = Math.floor(position * framesPerItem);
    const endFrame = position === ordered.length - 1 ? durationInFrames : Math.floor((position + 1) * framesPerItem);
    const order = normalizeClipOrder(clip.order, position + 1);
    const item: BrollTimelineItem = {
      clip,
      startFrame,
      durationInFrames: Math.max(1, Math.min(getClipDurationInFrames(clip), endFrame - startFrame)),
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

function buildBoxStyle(
  box: { x: number; y: number; width: number; height: number },
  overrides: React.CSSProperties = {},
): React.CSSProperties {
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

export function AvatarLeftSlidesBrollRight(props: TemplateProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const slides = orderedSlides(props.slides);
  const brollClips = orderedBrollClips(props.brollClips);
  const slideTimeline = buildSlideTimeline(slides, durationInFrames, props.timelineOverrides);
  const brollTimeline = buildBrollTimeline(brollClips, durationInFrames, props.timelineOverrides);
  const activeSlideItem = getActiveSlideTimelineItem(frame, slideTimeline);
  const activeBrollItem = getActiveBrollTimelineItem(frame, brollTimeline);
  const activeSlide = activeSlideItem?.slide ?? null;
  const activeBroll = activeBrollItem?.clip ?? null;
  const hasAvatar = typeof props.avatarVideoUrl === "string" && props.avatarVideoUrl.length > 0;
  const hasVoice = typeof props.voiceAudioUrl === "string" && props.voiceAudioUrl.length > 0;
  const slideLocalFrame = activeSlideItem ? Math.max(0, frame - activeSlideItem.startFrame) : 0;
  const slideOpacity = interpolate(slideLocalFrame, [0, 10], [0.72, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const backgroundOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.BACKGROUND);
  const avatarOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.AVATAR);
  const primaryVisualOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL);
  const slideOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.SLIDES);
  const brollOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.BROLL);
  const activeSlideItemOverride = activeSlideItem
    ? buildLayoutOverrideStyle(props.layoutOverrides, activeSlideItem.layerId)
    : {};
  const activeBrollItemOverride = activeBrollItem
    ? buildLayoutOverrideStyle(
        props.layoutOverrides,
        activeBrollItem.layerId,
      )
    : {};

  return (
    <AbsoluteFill
      style={{
        background: "#05070b",
        fontFamily: "Inter, Arial, sans-serif",
        overflow: "hidden",
        ...backgroundOverride,
      }}
    >
      <div
        style={buildBoxStyle(primaryVisualBox, {
          background: "#090d14",
          zIndex: defaultStackOrders.primaryVisual,
          ...primaryVisualOverride,
        })}
      />

      {hasAvatar ? (
        <div
          style={buildBoxStyle(avatarBox, {
            background: "transparent",
            zIndex: defaultStackOrders.avatar,
            ...avatarOverride,
          })}
        >
          <SafeRenderVideo
            src={props.avatarVideoUrl!}
            muted={hasVoice}
            durationInFrames={durationInFrames}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center center",
            }}
          />
        </div>
      ) : null}

      {activeSlide && activeSlideItem ? (
        <Sequence from={activeSlideItem.startFrame} durationInFrames={activeSlideItem.durationInFrames}>
          <div
            style={buildBoxStyle(slidesBox, {
              background: "transparent",
              opacity: slideOpacity,
              zIndex: defaultStackOrders.slides,
              ...slideOverride,
              ...activeSlideItemOverride,
            })}
          >
            <Img
              src={activeSlide.url}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                objectPosition: "center center",
              }}
            />
          </div>
        </Sequence>
      ) : null}

      {activeBroll && activeBrollItem ? (
        <Sequence from={activeBrollItem.startFrame} durationInFrames={activeBrollItem.durationInFrames}>
          <div
            style={buildBoxStyle(brollBox, {
              background: "transparent",
              zIndex: defaultStackOrders.broll,
              ...brollOverride,
              ...activeBrollItemOverride,
            })}
          >
            <SafeRenderVideo
              src={activeBroll.url}
              muted
              durationInFrames={activeBrollItem.durationInFrames}
              loop={activeBrollItem.loopMode !== "freeze"}
              sourceStartFrame={activeBrollItem.sourceStartFrame}
              sourceEndFrame={activeBrollItem.sourceEndFrame ?? getClipDurationInFrames(activeBroll)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "center center",
              }}
            />
          </div>
        </Sequence>
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
      component={AvatarLeftSlidesBrollRight}
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

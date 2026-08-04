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
  Freeze,
  Img,
  Sequence,
  Video,
  interpolate,
  registerRoot,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";

type SlideAsset = {
  animationCount?: number;
  classes?: string;
  html?: string;
  index?: number;
  kind?: "image" | "html";
  label?: string;
  url?: string;
};

type DeckFont = {
  family?: string;
  href: string;
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
  trackKind?: "slides" | "broll" | "avatar";
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

type AvatarTimelineItem = {
  clip: AvatarClip;
  startFrame: number;
  durationInFrames: number;
  id: string;
  layerId: string;
  sourceStartFrame?: number;
  sourceEndFrame?: number;
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
  deckCss?: string;
  deckFonts?: DeckFont[];
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

const compositionId = ${json(blueprint.compositionId)};
const compositionWidth = ${blueprint.width};
const compositionHeight = ${blueprint.height};
const fallbackFps = ${blueprint.fps};
const fallbackDurationInFrames = ${blueprint.fallbackDurationFrames};
const accentColor = ${json(blueprint.accentColor)};
const layoutMode = ${json(blueprint.layout)};
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
  avatarClips: [],
  bgMusicVolume: 0.12,
  brollClips: [],
  deckCss: "",
  deckFonts: [],
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
const AVATAR_CLIP_CROSSFADE_FRAMES = 8;
const REMOTE_VIDEO_END_PADDING_FRAMES = 15;

function getAvatarClipItemLayerId(order: number) {
  return "avatar:" + Math.max(1, Math.round(order));
}

function orderedSlides(slides: SlideAsset[] = []) {
  return slides
    .filter((slide) => {
      if (slide.kind === "html" || typeof slide.html === "string") {
        return typeof slide.html === "string" && slide.html.length > 0;
      }
      return typeof slide.url === "string" && slide.url.length > 0;
    })
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
}

function isHtmlSlide(slide: SlideAsset) {
  return (slide.kind === "html" || typeof slide.html === "string") && typeof slide.html === "string" && slide.html.length > 0;
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

function resolveSafeRemoteVideoRange(params: {
  sourceStartFrame?: number;
  sourceEndFrame?: number;
  fallbackDurationInFrames: number;
  sequenceDurationInFrames: number;
}) {
  const sourceStartFrame = normalizeOptionalFrame(params.sourceStartFrame) ?? 0;
  const fallbackEndFrame = sourceStartFrame + Math.max(1, Math.round(params.fallbackDurationInFrames));
  const requestedSourceEndFrame = Math.max(
    sourceStartFrame + 1,
    normalizeOptionalFrame(params.sourceEndFrame) ?? fallbackEndFrame,
  );
  const requestedSourceDurationInFrames = requestedSourceEndFrame - sourceStartFrame;
  const shouldPadEnd = requestedSourceDurationInFrames > REMOTE_VIDEO_END_PADDING_FRAMES + 1;
  const sourceEndFrame = shouldPadEnd
    ? requestedSourceEndFrame - REMOTE_VIDEO_END_PADDING_FRAMES
    : requestedSourceEndFrame;
  const sourceDurationInFrames = Math.max(1, sourceEndFrame - sourceStartFrame);
  const sequenceDurationInFrames = Math.max(1, Math.round(params.sequenceDurationInFrames));

  return {
    sourceStartFrame,
    sourceEndFrame,
    sourceDurationInFrames,
    tailFreezeInFrames: Math.max(0, sequenceDurationInFrames - sourceDurationInFrames),
  };
}

function SafeRemoteVideo(props: {
  src: string;
  muted?: boolean;
  volume?: number;
  startFrom?: number;
  endAt?: number;
  fallbackDurationInFrames: number;
  durationInFrames: number;
  style?: React.CSSProperties;
}) {
  const sourceRange = resolveSafeRemoteVideoRange({
    sourceStartFrame: props.startFrom,
    sourceEndFrame: props.endAt,
    fallbackDurationInFrames: props.fallbackDurationInFrames,
    sequenceDurationInFrames: props.durationInFrames,
  });
  const video = (
    <Video
      src={props.src}
      muted={props.muted}
      volume={props.volume}
      startFrom={sourceRange.sourceStartFrame}
      endAt={sourceRange.sourceEndFrame}
      style={props.style}
    />
  );

  if (sourceRange.tailFreezeInFrames <= 0) return video;

  return (
    <>
      <Sequence from={0} durationInFrames={sourceRange.sourceDurationInFrames}>
        {video}
      </Sequence>
      <Sequence from={sourceRange.sourceDurationInFrames} durationInFrames={sourceRange.tailFreezeInFrames}>
        <Freeze frame={sourceRange.sourceDurationInFrames - 1}>{video}</Freeze>
      </Sequence>
    </>
  );
}

function getTimelineOverrideSegments(
  manifests: TimelineOverrideManifest[] | null | undefined,
  trackKind: "slides" | "broll" | "avatar",
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
      id: "slide-" + index,
      layerId: "slide:" + index,
      index,
    };
    const override = findTimelineOverrideSegment(segments, item);

    return override ? { ...item, ...resolveOverrideWindow(override, durationInFrames) } : item;
  }).filter((item) => item.durationInFrames > 0);
}

function getActiveSlideTimelineItem(frame: number, timeline: SlideTimelineItem[]) {
  return timeline.find((item) => frame >= item.startFrame && frame < item.startFrame + item.durationInFrames) ?? null;
}

function getClipDurationInFrames(clip: BrollClip) {
  return typeof clip.durationInFrames === "number" && Number.isFinite(clip.durationInFrames)
    ? Math.max(1, Math.round(clip.durationInFrames))
    : 150;
}

function getAvatarClipDurationInFrames(clip: AvatarClip) {
  return typeof clip.durationInFrames === "number" && Number.isFinite(clip.durationInFrames)
    ? Math.max(1, Math.round(clip.durationInFrames))
    : 150;
}

function getAvatarClipCrossfadeFrames(currentClip: AvatarClip, nextClip: AvatarClip) {
  const currentDuration = getAvatarClipDurationInFrames(currentClip);
  const nextDuration = getAvatarClipDurationInFrames(nextClip);
  const boundedByClipLength = Math.min(
    Math.floor(currentDuration / 4),
    Math.floor(nextDuration / 4),
  );

  return Math.max(0, Math.min(AVATAR_CLIP_CROSSFADE_FRAMES, boundedByClipLength));
}

function getAvatarTimelineItemFadeFrames(
  item: AvatarTimelineItem,
  index: number,
  timeline: AvatarTimelineItem[],
) {
  const previousItem = timeline[index - 1];
  const nextItem = timeline[index + 1];
  const currentDuration = Math.max(1, item.durationInFrames);
  const maxFadeFrames = Math.max(0, currentDuration - 1);

  return {
    fadeInFrames: previousItem
      ? Math.min(maxFadeFrames, Math.max(0, previousItem.startFrame + previousItem.durationInFrames - item.startFrame))
      : 0,
    fadeOutFrames: nextItem
      ? Math.min(maxFadeFrames, Math.max(0, item.startFrame + item.durationInFrames - nextItem.startFrame))
      : 0,
  };
}

function getAvatarTimelineItemOpacity(
  frame: number,
  item: AvatarTimelineItem,
  index: number,
  timeline: AvatarTimelineItem[],
) {
  const localFrame = Math.max(0, frame - item.startFrame);
  const { fadeInFrames, fadeOutFrames } = getAvatarTimelineItemFadeFrames(item, index, timeline);
  const fadeInOpacity = fadeInFrames > 0
    ? interpolate(localFrame, [0, fadeInFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 1;
  const fadeOutOpacity = fadeOutFrames > 0
    ? interpolate(localFrame, [Math.max(0, item.durationInFrames - fadeOutFrames), item.durationInFrames - 1], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 1;

  return Math.min(fadeInOpacity, fadeOutOpacity);
}

function buildBrollTimeline(
  clips: BrollClip[],
  durationInFrames: number,
  timelineOverrides: TimelineOverrideManifest[] | null | undefined,
): BrollTimelineItem[] {
  if (clips.length === 0 || durationInFrames <= 0) return [];

  const ordered = orderedBrollClips(clips);
  const segments = getTimelineOverrideSegments(timelineOverrides, "broll");
  const totalClipFrames = ordered.reduce((sum, clip) => sum + getClipDurationInFrames(clip), 0);
  const availableGapFrames = Math.max(0, durationInFrames - totalClipFrames);
  const gapFrames = availableGapFrames > 0 ? Math.floor(availableGapFrames / (ordered.length + 1)) : 0;
  const timeline: BrollTimelineItem[] = [];
  let cursor = gapFrames;

  for (const clip of ordered) {
    if (cursor >= durationInFrames) break;
    const remainingFrames = durationInFrames - cursor;
    const clipDurationInFrames = Math.min(getClipDurationInFrames(clip), remainingFrames);

    if (clipDurationInFrames > 0) {
      const order = normalizeClipOrder(clip.order, timeline.length + 1);
      const item: BrollTimelineItem = {
        clip,
        startFrame: cursor,
        durationInFrames: clipDurationInFrames,
        id: "broll-" + order,
        layerId: "broll:" + order,
      };
      const override = findTimelineOverrideSegment(segments, item);
      const overriddenItem = override
        ? {
          ...item,
          ...resolveOverrideWindow(override, durationInFrames),
          sourceStartFrame: normalizeOptionalFrame(override.sourceStartFrame),
          sourceEndFrame: normalizeOptionalFrame(override.sourceEndFrame),
          loopMode: override.loopMode,
        }
        : item;

      timeline.push(overriddenItem);
    }

    cursor += clipDurationInFrames + gapFrames;
  }

  return timeline;
}

function getActiveBrollTimelineItem(frame: number, timeline: BrollTimelineItem[]) {
  return timeline.find((item) => frame >= item.startFrame && frame < item.startFrame + item.durationInFrames) ?? null;
}

function buildAvatarTimeline(
  clips: AvatarClip[],
  durationInFrames: number,
  timelineOverrides: TimelineOverrideManifest[] | null | undefined,
): AvatarTimelineItem[] {
  if (clips.length === 0 || durationInFrames <= 0) return [];

  const ordered = orderedAvatarClips(clips);
  const segments = getTimelineOverrideSegments(timelineOverrides, "avatar");
  const timeline: AvatarTimelineItem[] = [];
  let cursor = 0;

  for (let index = 0; index < ordered.length; index += 1) {
    const clip = ordered[index]!;
    if (cursor >= durationInFrames) break;
    const remainingFrames = durationInFrames - cursor;
    const clipDurationInFrames = Math.min(getAvatarClipDurationInFrames(clip), remainingFrames);

    if (clipDurationInFrames > 0) {
      const order = normalizeClipOrder(clip.order, timeline.length + 1);
      const item: AvatarTimelineItem = {
        clip,
        startFrame: cursor,
        durationInFrames: clipDurationInFrames,
        id: "avatar-" + order,
        layerId: getAvatarClipItemLayerId(order),
        sourceStartFrame: 0,
        sourceEndFrame: getAvatarClipDurationInFrames(clip),
      };
      const override = findTimelineOverrideSegment(segments, item);
      const overriddenItem = override
        ? {
          ...item,
          ...resolveOverrideWindow(override, durationInFrames),
          sourceStartFrame: normalizeOptionalFrame(override.sourceStartFrame) ?? item.sourceStartFrame,
          sourceEndFrame: normalizeOptionalFrame(override.sourceEndFrame) ?? item.sourceEndFrame,
        }
        : item;

      timeline.push(overriddenItem);
    }

    const nextClip = ordered[index + 1];
    const crossfadeFrames = nextClip
      ? getAvatarClipCrossfadeFrames(clip, nextClip)
      : 0;

    cursor += Math.max(1, clipDurationInFrames - crossfadeFrames);
  }

  return timeline;
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

function getRenderableDeckFonts(fonts: DeckFont[] | null | undefined) {
  if (!Array.isArray(fonts)) return [];
  return fonts.filter((font) => typeof font.href === "string" && /^https:\\/\\/fonts\\.googleapis\\.com\\//i.test(font.href));
}

function DeckRuntimeStyles(props: { deckCss?: string; deckFonts?: DeckFont[] }) {
  const fonts = getRenderableDeckFonts(props.deckFonts);

  return (
    <>
      {fonts.map((font, index) => (
        <link key={font.href + index} rel="stylesheet" href={font.href} />
      ))}
      {typeof props.deckCss === "string" && props.deckCss.length > 0 ? <style>{props.deckCss}</style> : null}
    </>
  );
}

function renderSlideAsset(slide: SlideAsset, box: Box, localFrame: number, fps: number) {
  if (!isHtmlSlide(slide)) {
    return (
      <Img
        src={slide.url || ""}
        style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center center" }}
      />
    );
  }

  const scale = Math.min(box.width / compositionWidth, box.height / compositionHeight);
  const scaledWidth = Math.max(1, Math.round(compositionWidth * scale));
  const scaledHeight = Math.max(1, Math.round(compositionHeight * scale));
  const offsetX = Math.round((box.width - scaledWidth) / 2);
  const offsetY = Math.round((box.height - scaledHeight) / 2);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div
        className="deck-scope"
        style={{
          position: "absolute",
          left: offsetX,
          top: offsetY,
          width: compositionWidth,
          height: compositionHeight,
          zoom: scale,
        }}
      >
        <section
          className={\`\${slide.classes || "slide"} active\`}
          style={{
            "--deck-t": String(Math.max(0, localFrame) / Math.max(1, fps)),
          } as React.CSSProperties}
          dangerouslySetInnerHTML={{ __html: slide.html || "" }}
        />
      </div>
    </div>
  );
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
  const avatarClips = orderedAvatarClips(props.avatarClips);
  const slideTimeline = buildSlideTimeline(slides, durationInFrames, props.timelineOverrides);
  const brollTimeline = buildBrollTimeline(brollClips, durationInFrames, props.timelineOverrides);
  const avatarTimeline = buildAvatarTimeline(avatarClips, durationInFrames, props.timelineOverrides);
  const activeSlideItem = getActiveSlideTimelineItem(frame, slideTimeline);
  const activeSlideIndex = activeSlideItem?.index ?? -1;
  const activeSupportIndex = getActiveIndex(frame, Math.max(slides.length, brollClips.length), durationInFrames);
  const activeSlide = activeSlideItem?.slide ?? null;
  const activeBrollItem = getActiveBrollTimelineItem(frame, brollTimeline);
  const activeBroll = activeBrollItem?.clip ?? null;
  const hasVoice = typeof props.voiceAudioUrl === "string" && props.voiceAudioUrl.length > 0;
  const hasAvatarVideo = typeof props.avatarVideoUrl === "string" && props.avatarVideoUrl.length > 0;
  const hasAvatarClips = avatarTimeline.length > 0;
  const hasAvatar = hasAvatarClips || hasAvatarVideo;
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
      <DeckRuntimeStyles deckCss={props.deckCss} deckFonts={props.deckFonts} />

      <div style={buildBoxStyle(primaryVisualBox, { background: isReferenceFrameLayout ? "transparent" : tokenSurface, zIndex: defaultStackOrders.primaryVisual, ...primaryVisualOverride })} />

      {hasAvatarClips ? (
        <>
          {avatarTimeline.map((avatarItem, avatarIndex) => {
            const avatarOpacity = getAvatarTimelineItemOpacity(frame, avatarItem, avatarIndex, avatarTimeline);
            const avatarItemOverride = buildLayoutOverrideStyle(props.layoutOverrides, avatarItem.layerId);

            return (
              <Sequence key={avatarItem.id} from={avatarItem.startFrame} durationInFrames={avatarItem.durationInFrames}>
                <div style={buildBoxStyle(avatarSceneBox, { background: isReferenceFrameLayout ? tokenSurface : "transparent", zIndex: defaultStackOrders.avatar, opacity: avatarOpacity, ...avatarOverride, ...avatarItemOverride })}>
                  <SafeRemoteVideo
                    src={avatarItem.clip.url}
                    muted={hasVoice}
                    volume={hasVoice ? 0 : avatarOpacity}
                    startFrom={avatarItem.sourceStartFrame}
                    endAt={avatarItem.sourceEndFrame}
                    fallbackDurationInFrames={getAvatarClipDurationInFrames(avatarItem.clip)}
                    durationInFrames={avatarItem.durationInFrames}
                    style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" }}
                  />
                </div>
              </Sequence>
            );
          })}
        </>
      ) : hasAvatarVideo ? (
        <div style={buildBoxStyle(avatarSceneBox, { background: isReferenceFrameLayout ? tokenSurface : "transparent", zIndex: defaultStackOrders.avatar, ...avatarOverride })}>
          <SafeRemoteVideo
            src={props.avatarVideoUrl!}
            muted={hasVoice}
            fallbackDurationInFrames={durationInFrames}
            durationInFrames={durationInFrames}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" }}
          />
        </div>
      ) : null}

      {activeSlide && activeSlideItem ? (
        <Sequence from={activeSlideItem.startFrame} durationInFrames={activeSlideItem.durationInFrames}>
          <div style={buildBoxStyle(slidesSceneBox, { background: tokenSurface, opacity: slideOpacity, zIndex: defaultStackOrders.slides, ...slidesOverride, ...activeSlideItemOverride })}>
            {renderSlideAsset(activeSlide, slidesSceneBox, slideLocalFrame, fallbackFps)}
          </div>
        </Sequence>
      ) : null}

      {activeBroll && activeBrollItem ? (
        <Sequence from={activeBrollItem.startFrame} durationInFrames={activeBrollItem.durationInFrames}>
          <div style={buildBoxStyle(brollSceneBox, { background: isReferenceFrameLayout ? tokenSurface : "transparent", zIndex: defaultStackOrders.broll, ...brollOverride, ...activeBrollItemOverride })}>
            <SafeRemoteVideo
              src={activeBroll.url}
              muted
              startFrom={activeBrollItem.sourceStartFrame}
              endAt={activeBrollItem.sourceEndFrame}
              fallbackDurationInFrames={getClipDurationInFrames(activeBroll)}
              durationInFrames={activeBrollItem.durationInFrames}
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
`;
}

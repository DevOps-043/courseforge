import React from "react";
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
  avatarVideoUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  brollClips?: BrollClip[];
  layoutOverrides?: LayoutOverrideManifest[];
  slides?: SlideAsset[];
  totalDurationInFrames?: number;
  voiceAudioUrl?: string;
};

const fallbackDurationInFrames = 1800;
const fallbackFps = 30;
const compositionWidth = 1920;
const compositionHeight = 1080;
const compositionId = "avatar-left-slides-broll-right";
const defaultProps: TemplateProps = {
  avatarVideoUrl: "",
  bgMusicUrl: "",
  bgMusicVolume: 0.12,
  brollClips: [],
  layoutOverrides: [],
  slides: [],
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
  }

  return style;
}

function getActiveSlideIndex(frame: number, slideCount: number, durationInFrames: number) {
  if (slideCount <= 0) return -1;

  const framesPerSlide = durationInFrames / slideCount;
  return Math.min(slideCount - 1, Math.floor(frame / Math.max(1, framesPerSlide)));
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
  const activeSlideIndex = getActiveSlideIndex(frame, slides.length, durationInFrames);
  const activeSlide = activeSlideIndex >= 0 ? slides[activeSlideIndex] : null;
  const activeBroll = activeSlideIndex >= 0 ? brollClips[activeSlideIndex] ?? null : null;
  const hasAvatar = typeof props.avatarVideoUrl === "string" && props.avatarVideoUrl.length > 0;
  const hasVoice = typeof props.voiceAudioUrl === "string" && props.voiceAudioUrl.length > 0;
  const hasBroll = Boolean(activeBroll);
  const slideOpacity = interpolate(frame % Math.max(1, durationInFrames / Math.max(1, slides.length)), [0, 10], [0.72, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const backgroundOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.BACKGROUND);
  const avatarOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.AVATAR);
  const primaryVisualOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL);
  const slideOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.SLIDES);
  const brollOverride = buildLayoutOverrideStyle(props.layoutOverrides, REMOTION_EDITABLE_LAYERS.BROLL);

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
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "42% 58%",
          gap: 0,
        }}
      >
        <section
          style={{
            position: "relative",
            minWidth: 0,
            height: "100%",
            background: "#05070b",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            ...avatarOverride,
          }}
        >
          {hasAvatar ? (
            <Video
              src={props.avatarVideoUrl!}
              muted={hasVoice}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "center center",
              }}
            />
          ) : null}
        </section>

        <section
          style={{
            position: "relative",
            minWidth: 0,
            height: "100%",
            background: "#090d14",
            overflow: "hidden",
            ...primaryVisualOverride,
          }}
        >
          {activeSlide ? (
            <div
              style={{
                position: "absolute",
                left: 36,
                right: 36,
                top: 36,
                bottom: hasBroll ? 382 : 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                opacity: slideOpacity,
                ...slideOverride,
              }}
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
          ) : null}

          {activeBroll ? (
            <div
              style={{
                position: "absolute",
                right: 36,
                bottom: 36,
                width: 520,
                height: 292,
                background: "#000",
                overflow: "hidden",
                ...brollOverride,
              }}
            >
              <Video
                src={activeBroll.url}
                muted
                loop
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "center center",
                }}
              />
            </div>
          ) : null}
        </section>
      </div>

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

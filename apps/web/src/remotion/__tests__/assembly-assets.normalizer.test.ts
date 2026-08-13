import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAssemblyProps, hasPreviewableAssets } from "../buildAssemblyProps";
import {
  getAssemblyAssetReadiness,
  normalizeAssemblyAssets,
} from "../assembly-assets.normalizer";
import {
  ASSEMBLY_FPS,
  ASSEMBLY_HEIGHT,
  ASSEMBLY_TEMPLATES,
  ASSEMBLY_WIDTH,
  safeParseAssemblyInputProps,
} from "../types";
import { DEFAULT_TEMPLATE_RENDER_CONFIG } from "../template-config";
import {
  filterLayoutOverridesForEditableLayers,
  safeParseLayoutOverrideManifests,
} from "../layout-overrides";
import { safeParseTimelineOverrideManifests } from "../timeline-overrides";
import {
  buildLayoutOverrideStyle,
  getAvatarClipItemLayerId,
  getBrollItemLayerId,
  getSlideItemLayerId,
  REMOTION_EDITABLE_LAYERS,
} from "../layout-override-styles";
import {
  buildBrollTimeline,
  buildVisualTimeline,
  getActiveTimelineSegments,
} from "../visual-timeline";
import { AVATAR_CLIP_CROSSFADE_FRAMES } from "../avatar-clip-transitions";
import {
  durationSecondsToFrames,
  normalizeMeasuredDurationSeconds,
} from "../media-duration";
import { resolveSafeRemoteVideoRange } from "../remote-video-source-range";
import { resolveSlideTimelineRenderItems } from "../components/slide-timeline-rendering";
import {
  commitLayoutLayerCrop,
  commitLayoutLayerBox,
  createEmptyLayoutOverrideManifest,
  getEditableLayoutLayers,
  getDefaultLayoutLayerBox,
  getEffectiveLayoutLayerBox,
  getEffectiveLayoutLayerStackOrder,
  getLayoutLayerStackPosition,
  moveLayoutLayerInStack,
  resetLayoutLayerToDefault,
} from "../../domains/materials/components/layoutOverrideDraftModel";
import type { MaterialAssets } from "../../domains/materials/types/materials.types";

const VIDEO_URL = "https://cdn.example.com/video.mp4";
const AUDIO_URL = "https://cdn.example.com/audio.mp3";
const IMAGE_URL = "https://cdn.example.com/slide.png";

function baseClip(params: Partial<NonNullable<MaterialAssets["b_roll_clips"]>[number]>) {
  return {
    id: params.id ?? "clip",
    storage_path: params.storage_path ?? "production-assets/broll/clip.mp4",
    public_url: params.public_url ?? VIDEO_URL,
    duration: params.duration,
    prompt_used: params.prompt_used,
    order: params.order ?? 1,
  };
}

function baseAvatarClip(params: Partial<NonNullable<MaterialAssets["avatar_clips"]>[number]>) {
  return {
    id: params.id ?? "avatar-clip",
    order: params.order ?? 1,
    deleted: params.deleted,
    public_url: params.public_url ?? VIDEO_URL,
    script_text: params.script_text ?? "Texto de prueba",
    status: params.status ?? "COMPLETED",
    storage_path: params.storage_path ?? "production-assets/avatar/clip.mp4",
    duration: params.duration,
  };
}

describe("normalizeAssemblyAssets", () => {
  it("keeps remote video source ranges away from fragile final frames", () => {
    const range = resolveSafeRemoteVideoRange({
      fallbackDurationInFrames: 600,
      sequenceDurationInFrames: 600,
    });

    assert.deepEqual(range, {
      sourceStartFrame: 0,
      sourceEndFrame: 585,
      sourceDurationInFrames: 585,
      tailFreezeInFrames: 15,
    });
  });

  it("does not pad very short remote video ranges out of existence", () => {
    const range = resolveSafeRemoteVideoRange({
      sourceStartFrame: 3,
      sourceEndFrame: 8,
      fallbackDurationInFrames: 5,
      sequenceDurationInFrames: 5,
    });

    assert.deepEqual(range, {
      sourceStartFrame: 3,
      sourceEndFrame: 8,
      sourceDurationInFrames: 5,
      tailFreezeInFrames: 0,
    });
  });

  it("preserves measured duration precision and floors frame conversion", () => {
    assert.equal(normalizeMeasuredDurationSeconds(19.7289), 19.728);
    assert.equal(durationSecondsToFrames(19.728, ASSEMBLY_FPS), 591);
    assert.equal(normalizeMeasuredDurationSeconds(Number.NaN), null);
  });

  it("sorts slide images by slide_index and normalizes them to contiguous layer indexes", () => {
    const assets: MaterialAssets = {
      slides: {
        images: [
          {
            slide_index: 2,
            storage_path: "production-assets/slides/2.png",
            public_url: "https://cdn.example.com/slide-2.png",
          },
          {
            slide_index: 1,
            storage_path: "production-assets/slides/1.png",
            public_url: "https://cdn.example.com/slide-1.png",
          },
        ],
      },
    };

    const normalized = normalizeAssemblyAssets(assets, ASSEMBLY_FPS);

    assert.deepEqual(
      normalized.slides.map((slide) => slide.index),
      [0, 1],
    );
    assert.deepEqual(
      normalized.slides.map((slide) => slide.url),
      [
        "https://cdn.example.com/slide-1.png",
        "https://cdn.example.com/slide-2.png",
      ],
    );
    assert.equal(normalized.totalDurationSeconds, 10);
  });

  it("detects slide references that are not yet renderizable by Remotion", () => {
    const assets: MaterialAssets = {
      slides_url: "https://cdn.example.com/slides.html",
      slides: {
        html_public_url: "https://cdn.example.com/slides.html",
        html_content_path: "production-assets/slides/slides.html",
      },
    };

    const readiness = getAssemblyAssetReadiness(assets, ASSEMBLY_FPS);

    assert.equal(readiness.hasAnyAssetReference, true);
    assert.equal(readiness.hasRenderableAssets, false);
    assert.equal(readiness.canRender, false);
    assert.equal(readiness.manifest.slideCount, 0);
    assert.equal(
      readiness.warnings.some(
        (warning) => warning.code === "SLIDES_REFERENCE_NOT_RENDERIZABLE",
      ),
      true,
    );
    assert.equal(hasPreviewableAssets(assets), true);
  });

  it("blocks an avatar render when referenced slides would silently disappear", () => {
    const readiness = getAssemblyAssetReadiness({
      slides_url: "https://cdn.example.com/slides.html",
      avatar_video: {
        public_url: VIDEO_URL,
        storage_path: "production-assets/avatar.mp4",
        duration: 20,
      },
    }, ASSEMBLY_FPS);

    assert.equal(readiness.hasRenderableAssets, true);
    assert.equal(readiness.canRender, false);
    assert.equal(readiness.manifest.hasAvatarVideo, true);
    assert.equal(readiness.blockingIssues[0]?.code, "SLIDES_REFERENCE_NOT_RENDERIZABLE");
  });

  it("treats slide references with generated images as renderable", () => {
    const assets: MaterialAssets = {
      slides_url: "https://cdn.example.com/slides.html",
      slides: {
        html_public_url: "https://cdn.example.com/slides.html",
        images: [
          {
            slide_index: 1,
            storage_path: "production-assets/slides/1.svg",
            public_url: "https://cdn.example.com/slide-1.svg",
          },
        ],
      },
    };

    const readiness = getAssemblyAssetReadiness(assets, ASSEMBLY_FPS);

    assert.equal(readiness.hasRenderableAssets, true);
    assert.equal(readiness.canRender, true);
    assert.equal(readiness.manifest.slideCount, 1);
    assert.equal(
      readiness.warnings.some(
        (warning) => warning.code === "SLIDES_REFERENCE_NOT_RENDERIZABLE",
      ),
      false,
    );
  });

  it("prioritizes prepared animated decks over legacy slide images", () => {
    const assets: MaterialAssets = {
      slides: {
        animated_deck: {
          animated_slide_count: 1,
          cleanup_report: { slideCount: 2 },
          css: ".deck-scope .slide { width: 1920px; height: 1080px; }",
          fonts: [
            {
              family: "Outfit",
              href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;700&display=swap",
              source: "google",
            },
          ],
          height: 1080,
          slide_count: 2,
          slides: [
            {
              animationCount: 1,
              classes: "slide s-center",
              html: "<h1>Animated tÃ­tulo</h1>",
              index: 1,
              label: "01 Animated",
            },
            {
              animationCount: 0,
              classes: "slide s-center",
              html: "<h1>Static</h1>",
              index: 2,
              label: "02 Static",
            },
          ],
          source: "manual_upload",
          source_html_path: "production-assets/slides/source.html",
          static_slide_count: 1,
          status: "READY_FOR_RENDER",
          validation_report: { isValid: true },
          width: 1920,
        },
        images: [
          {
            slide_index: 1,
            storage_path: "production-assets/slides/legacy.png",
            public_url: "https://cdn.example.com/legacy.png",
          },
        ],
      },
    };

    const normalized = normalizeAssemblyAssets(assets, ASSEMBLY_FPS);
    const props = buildAssemblyProps(assets, ASSEMBLY_TEMPLATES.FULL_SLIDES);

    assert.deepEqual(
      normalized.slides.map((slide) => slide.kind),
      ["html", "html"],
    );
    assert.equal(normalized.slides[0].classes, "slide s-center active");
    assert.equal(normalized.slides[0].html, "<h1>Animated título</h1>");
    assert.equal(normalized.deckCss, ".deck-scope .slide { width: 1920px; height: 1080px; }");
    assert.deepEqual(normalized.deckFonts.map((font) => font.family), ["Outfit"]);
    assert.equal(props.slides[0].kind, "html");
    assert.equal(props.deckFonts[0].family, "Outfit");
    assert.equal(props.totalDurationInFrames, 10 * ASSEMBLY_FPS);
  });

  it("treats completed avatar clips as renderable without a merged avatar video", () => {
    const assets: MaterialAssets = {
      avatar_clips: [
        baseAvatarClip({
          id: "avatar-1",
          public_url: "https://cdn.example.com/avatar-1.mp4",
          duration: 14.4,
          order: 1,
        }),
      ],
    };

    const readiness = getAssemblyAssetReadiness(assets, ASSEMBLY_FPS);
    const props = buildAssemblyProps(assets, ASSEMBLY_TEMPLATES.SPLIT_AVATAR);

    assert.equal(readiness.hasRenderableAssets, true);
    assert.equal(readiness.hasRenderableVisualAssets, true);
    assert.deepEqual(
      props.avatarClips.map((clip) => clip.url),
      ["https://cdn.example.com/avatar-1.mp4"],
    );
  });

  it("sorts multiple B-roll clips by order and falls back to clip duration", () => {
    const assets: MaterialAssets = {
      b_roll_clips: [
        baseClip({
          id: "third",
          public_url: "https://cdn.example.com/third.mp4",
          order: 3,
          duration: 2,
        }),
        baseClip({
          id: "first",
          public_url: "https://cdn.example.com/first.mp4",
          order: 1,
        }),
        baseClip({
          id: "second",
          public_url: "https://cdn.example.com/second.mp4",
          order: 2,
          duration: 4,
        }),
      ],
    };

    const normalized = normalizeAssemblyAssets(assets, ASSEMBLY_FPS);

    assert.deepEqual(
      normalized.brollClips.map((clip) => clip.url),
      [
        "https://cdn.example.com/first.mp4",
        "https://cdn.example.com/second.mp4",
        "https://cdn.example.com/third.mp4",
      ],
    );
    assert.deepEqual(
      normalized.brollClips.map((clip) => clip.durationInFrames),
      [150, 120, 60],
    );
    assert.equal(normalized.totalDurationSeconds, 6);
  });

  it("uses real avatar clip durations when scene mode is active", () => {
    const assets: MaterialAssets = {
      avatar_generation_mode: "scene_clips",
      avatar_clips: [
        baseAvatarClip({ id: "second", order: 2, duration: 8.4, public_url: "https://cdn.example.com/avatar-2.mp4" }),
        baseAvatarClip({ id: "first", order: 1, duration: 4.2, public_url: "https://cdn.example.com/avatar-1.mp4" }),
      ],
      avatar_video: {
        storage_path: "production-assets/avatar.mp4",
        public_url: VIDEO_URL,
        duration: 120,
      },
    };

    const props = buildAssemblyProps(assets, "avatar-focus");

    assert.equal(
      props.totalDurationInFrames,
      Math.floor(4.2 * ASSEMBLY_FPS) + Math.floor(8.4 * ASSEMBLY_FPS) - AVATAR_CLIP_CROSSFADE_FRAMES,
    );
    assert.deepEqual(
      props.avatarClips.map((clip) => clip.url),
      ["https://cdn.example.com/avatar-1.mp4", "https://cdn.example.com/avatar-2.mp4"],
    );
  });

  it("converts decimal video durations with floor so Remotion never seeks past the source", () => {
    const props = buildAssemblyProps(
      {
        avatar_generation_mode: "single_video",
        avatar_video: {
          storage_path: "production-assets/avatar.mp4",
          public_url: VIDEO_URL,
          duration: 19.728,
        },
      },
      "split-avatar",
    );

    assert.equal(props.totalDurationInFrames, 591);
  });

  it("ignores deleted avatar clips in scene mode duration and render props", () => {
    const props = buildAssemblyProps(
      {
        avatar_generation_mode: "scene_clips",
        avatar_clips: [
          baseAvatarClip({ id: "active", order: 1, duration: 5, public_url: "https://cdn.example.com/avatar-active.mp4" }),
          baseAvatarClip({ deleted: true, id: "deleted", order: 2, duration: 50, public_url: "https://cdn.example.com/avatar-deleted.mp4" }),
        ],
      },
      "avatar-focus",
    );

    assert.equal(props.totalDurationInFrames, 5 * ASSEMBLY_FPS);
    assert.deepEqual(
      props.avatarClips.map((clip) => clip.url),
      ["https://cdn.example.com/avatar-active.mp4"],
    );
  });

  it("uses the single avatar video duration when video-complete mode is active", () => {
    const props = buildAssemblyProps(
      {
        avatar_generation_mode: "single_video",
        avatar_clips: [baseAvatarClip({ duration: 30 })],
        avatar_video: {
          storage_path: "production-assets/avatar.mp4",
          public_url: VIDEO_URL,
          duration: 75,
        },
      },
      "split-avatar",
    );

    assert.equal(props.totalDurationInFrames, 75 * ASSEMBLY_FPS);
  });

  it("prioritizes voice duration over avatar, B-roll and slides", () => {
    const assets: MaterialAssets = {
      avatar_generation_mode: "single_video",
      voice_audio: {
        storage_path: "production-assets/voice.mp3",
        public_url: AUDIO_URL,
        duration: 12,
      },
      avatar_video: {
        storage_path: "production-assets/avatar.mp4",
        public_url: VIDEO_URL,
        duration: 30,
      },
      b_roll_clips: [baseClip({ duration: 20 })],
      slides: {
        images: [
          {
            slide_index: 1,
            storage_path: "production-assets/slides/1.png",
            public_url: IMAGE_URL,
          },
        ],
      },
    };

    const props = buildAssemblyProps(assets, "split-avatar");

    assert.equal(props.template, "split-avatar");
    assert.deepEqual(props.templateConfig, DEFAULT_TEMPLATE_RENDER_CONFIG);
    assert.equal(props.totalDurationInFrames, 12 * ASSEMBLY_FPS);
    assert.equal(props.voiceAudioUrl, AUDIO_URL);
    assert.equal(props.avatarVideoUrl, VIDEO_URL);
  });

  it("prefers measured voice duration over assembly target duration", () => {
    const props = buildAssemblyProps(
      {
        assembly_target_duration_seconds: 170,
        voice_audio: {
          storage_path: "production-assets/voice.mp3",
          public_url: AUDIO_URL,
          duration: 51,
        },
      },
      "full-slides",
    );

    assert.equal(props.totalDurationInFrames, 51 * ASSEMBLY_FPS);
  });

  it("prefers measured B-roll duration over assembly target duration", () => {
    const props = buildAssemblyProps(
      {
        assembly_target_duration_seconds: 170,
        b_roll_clips: [baseClip({ duration: 31 * 60 })],
      },
      "full-slides",
    );

    assert.equal(props.totalDurationInFrames, 31 * 60 * ASSEMBLY_FPS);
  });

  it("uses assembly target duration when assets have no measurable duration", () => {
    const props = buildAssemblyProps(
      {
        assembly_target_duration_seconds: 170,
        background_music: {
          storage_path: "production-assets/music.mp3",
          public_url: AUDIO_URL,
        },
      },
      "full-slides",
    );

    assert.equal(props.totalDurationInFrames, 170 * ASSEMBLY_FPS);
  });

  it("prefers slide-count duration over assembly target duration", () => {
    const props = buildAssemblyProps(
      {
        assembly_target_duration_seconds: 170,
        slides: {
          images: [
            { slide_index: 1, storage_path: "slides/1.png", public_url: IMAGE_URL },
            { slide_index: 2, storage_path: "slides/2.png", public_url: IMAGE_URL },
            { slide_index: 3, storage_path: "slides/3.png", public_url: IMAGE_URL },
          ],
        },
      },
      "full-slides",
    );

    assert.equal(props.totalDurationInFrames, 3 * 5 * ASSEMBLY_FPS);
  });

  it("prefers measured avatar duration over assembly target duration", () => {
    const props = buildAssemblyProps(
      {
        assembly_target_duration_seconds: 170,
        avatar_video: {
          storage_path: "production-assets/avatar.mp4",
          public_url: VIDEO_URL,
          duration: 51,
        },
        slides: {
          images: Array.from({ length: 26 }, (_, index) => ({
            slide_index: index + 1,
            storage_path: `slides/${index + 1}.png`,
            public_url: IMAGE_URL,
          })),
        },
      },
      "full-slides",
    );

    assert.equal(props.totalDurationInFrames, 51 * ASSEMBLY_FPS);
  });

  it("prefers default B-roll fallback duration over assembly target duration", () => {
    const props = buildAssemblyProps(
      {
        assembly_target_duration_seconds: 170,
        b_roll_clips: [baseClip({ duration: undefined })],
      },
      "full-slides",
    );

    assert.equal(props.totalDurationInFrames, 5 * ASSEMBLY_FPS);
  });

  it("uses assembly target duration over a stale timeline manifest when no asset duration is measurable", () => {
    const props = buildAssemblyProps(
      {
        assembly_target_duration_seconds: 42,
        timeline_overrides: [
          {
            version: 1,
            templateId: "full-slides",
            timeline: { fps: ASSEMBLY_FPS, durationInFrames: 9 * 60 * ASSEMBLY_FPS },
            segments: [
              {
                id: "broll-1",
                trackKind: "broll",
                startFrame: 30,
                endFrame: 120,
              },
            ],
          },
        ],
      },
      "full-slides",
    );

    assert.equal(props.totalDurationInFrames, 42 * ASSEMBLY_FPS);
    assert.equal(props.timelineOverrides[0].timeline.durationInFrames, 42 * ASSEMBLY_FPS);
  });

  it("falls back to the default template and duration for empty assets", () => {
    const props = buildAssemblyProps({}, "unknown-template");

    assert.equal(props.template, "full-slides");
    assert.equal(props.totalDurationInFrames, 10 * ASSEMBLY_FPS);
    assert.deepEqual(props.slides, []);
    assert.deepEqual(props.brollClips, []);
  });

  it("applies safe template config to preview props", () => {
    const props = buildAssemblyProps(
      {
        voice_audio: {
          storage_path: "production-assets/voice.mp3",
          public_url: AUDIO_URL,
          duration: 8,
        },
      },
      "full-slides",
      {
        accentColor: "#ff00aa",
        backgroundColor: "#101010",
        transitionType: "slide",
        avatarScale: 0.3,
      },
    );

    assert.equal(props.transitionType, "slide");
    assert.equal(props.templateConfig.accentColor, "#ff00aa");
    assert.equal(props.templateConfig.backgroundColor, "#101010");
    assert.equal(props.templateConfig.avatarScale, 0.3);
  });

  it("defaults layout overrides to an empty list", () => {
    const props = buildAssemblyProps(
      {
        voice_audio: {
          storage_path: "production-assets/voice.mp3",
          public_url: AUDIO_URL,
          duration: 8,
        },
      },
      "full-slides",
    );

    assert.deepEqual(props.layoutOverrides, []);
    assert.deepEqual(props.timelineOverrides, []);
  });

  it("accepts validated timeline overrides in preview props", () => {
    const props = buildAssemblyProps(
      {
        voice_audio: {
          storage_path: "production-assets/voice.mp3",
          public_url: AUDIO_URL,
          duration: 8,
        },
      },
      "full-slides",
      {},
      [],
      [
        {
          version: 1,
          templateId: "full-slides",
          componentId: "component-1",
          timeline: { fps: ASSEMBLY_FPS, durationInFrames: 12 * ASSEMBLY_FPS },
          segments: [
            {
              id: "broll-1",
              trackKind: "broll",
              layerId: "broll:1",
              startFrame: 30,
              endFrame: 180,
              sourceStartFrame: 15,
              sourceEndFrame: 75,
              loopMode: "loop",
            },
          ],
        },
      ],
    );

    assert.equal(props.timelineOverrides.length, 1);
    assert.equal(props.timelineOverrides[0].segments[0].loopMode, "loop");
    assert.equal(props.totalDurationInFrames, 8 * ASSEMBLY_FPS);
  });

  it("rejects invalid timeline ranges", () => {
    const parsed = safeParseTimelineOverrideManifests([
      {
        version: 1,
        timeline: { fps: ASSEMBLY_FPS, durationInFrames: 300 },
        segments: [
          {
            id: "slide-1",
            trackKind: "slides",
            startFrame: 120,
            endFrame: 30,
          },
        ],
      },
    ]);

    assert.equal(parsed.success, false);
  });

  it("accepts validated layout overrides in preview props", () => {
    const props = buildAssemblyProps(
      {
        voice_audio: {
          storage_path: "production-assets/voice.mp3",
          public_url: AUDIO_URL,
          duration: 8,
        },
      },
      "full-slides",
      {},
      [
        {
          version: 1,
          templateId: "full-slides",
          componentId: "component-1",
          canvas: { width: 1920, height: 1080, fps: ASSEMBLY_FPS },
          edits: [
            { layerId: "avatar", kind: "position", x: 1280, y: 620 },
            { layerId: "primaryVisual", kind: "size", width: 720, height: 405 },
            { layerId: "primaryVisual", kind: "crop", top: 0, right: 0.1, bottom: 0, left: 0 },
            { layerId: "avatar", kind: "stack", order: 30 },
          ],
        },
      ],
    );

    assert.equal(props.layoutOverrides.length, 1);
    assert.equal(props.layoutOverrides[0].edits.length, 4);
  });

  it("rejects arbitrary style data in layout overrides", () => {
    const parsed = safeParseLayoutOverrideManifests([
      {
        version: 1,
        canvas: { width: 1920, height: 1080 },
        edits: [
          {
            layerId: "avatar",
            kind: "position",
            x: 10,
            y: 20,
            css: "position:fixed;inset:0",
          },
        ],
      },
    ]);

    assert.equal(parsed.success, false);
  });

  it("rejects layout overrides outside safe bounds", () => {
    const parsed = safeParseLayoutOverrideManifests([
      {
        version: 1,
        canvas: { width: 1920, height: 1080 },
        edits: [{ layerId: "avatar", kind: "size", width: -1, height: 405 }],
      },
    ]);

    assert.equal(parsed.success, false);
  });

  it("rejects arbitrary stack values", () => {
    const parsed = safeParseLayoutOverrideManifests([
      {
        version: 1,
        canvas: { width: 1920, height: 1080 },
        edits: [{ layerId: "avatar", kind: "stack", order: 1001 }],
      },
    ]);

    assert.equal(parsed.success, false);
  });

  it("falls back from invalid template config values", () => {
    const parsed = safeParseAssemblyInputProps({
      template: "full-slides",
      fps: ASSEMBLY_FPS,
      totalDurationInFrames: 30,
      bgMusicVolume: 0.15,
      slides: [],
      brollClips: [],
      transitionType: "fade",
      templateConfig: {
        accentColor: "red",
        avatarScale: 99,
      },
    });

    assert.equal(parsed.success, false);
  });
});

describe("buildBrollTimeline", () => {
  it("orders clips and distributes available space as gaps", () => {
    const timeline = buildBrollTimeline(
      [
        { url: "https://cdn.example.com/two.mp4", order: 2, durationInFrames: 30 },
        { url: "https://cdn.example.com/one.mp4", order: 1, durationInFrames: 30 },
      ],
      120,
    );

    assert.deepEqual(
      timeline.map((item) => item.clip.url),
      ["https://cdn.example.com/one.mp4", "https://cdn.example.com/two.mp4"],
    );
    assert.deepEqual(
      timeline.map((item) => item.startFrame),
      [20, 70],
    );
  });

  it("clips B-roll duration when clips exceed composition duration", () => {
    const timeline = buildBrollTimeline(
      [
        { url: "https://cdn.example.com/one.mp4", order: 1, durationInFrames: 80 },
        { url: "https://cdn.example.com/two.mp4", order: 2, durationInFrames: 80 },
      ],
      100,
    );

    assert.deepEqual(
      timeline.map((item) => item.durationInFrames),
      [80, 20],
    );
    assert.deepEqual(
      timeline.map((item) => item.startFrame),
      [0, 80],
    );
  });
});

describe("buildVisualTimeline", () => {
  it("exposes preview tracks for audio, avatar, slides and b-roll", () => {
    const props = buildAssemblyProps(
      {
        voice_audio: {
          public_url: AUDIO_URL,
          storage_path: "production-assets/voice.mp3",
          duration: 8,
        },
        avatar_video: {
          public_url: VIDEO_URL,
          storage_path: "production-assets/avatar.mp4",
          duration: 8,
        },
        slides: {
          images: [
            {
              public_url: "https://cdn.example.com/slide-1.png",
              storage_path: "production-assets/slides/slide-1.png",
              slide_index: 0,
            },
            {
              public_url: "https://cdn.example.com/slide-2.png",
              storage_path: "production-assets/slides/slide-2.png",
              slide_index: 1,
            },
          ],
        },
        b_roll_clips: [
          baseClip({
            id: "clip-1",
            public_url: "https://cdn.example.com/broll-1.mp4",
            duration: 1,
            order: 1,
          }),
        ],
      },
      ASSEMBLY_TEMPLATES.FULL_SLIDES,
    );

    const timeline = buildVisualTimeline(props);

    assert.deepEqual(
      timeline.tracks.map((track) => track.id),
      ["audio", "avatar", "slides", "broll"],
    );
    assert.equal(timeline.durationInFrames, 8 * ASSEMBLY_FPS);
    assert.deepEqual(
      timeline.tracks.find((track) => track.id === "slides")?.segments.map((segment) => segment.layerId),
      [getSlideItemLayerId(0), getSlideItemLayerId(1)],
    );
    assert.deepEqual(
      timeline.tracks.find((track) => track.id === "broll")?.segments.map((segment) => segment.layerId),
      [getBrollItemLayerId(1)],
    );
  });

  it("creates overlapping avatar clip segments when avatarClips are present", () => {
    const props = buildAssemblyProps(
      {
        avatar_generation_mode: "scene_clips",
        avatar_clips: [
          baseAvatarClip({ id: "one", order: 1, duration: 2, public_url: "https://cdn.example.com/avatar-1.mp4" }),
          baseAvatarClip({ id: "two", order: 2, duration: 3, public_url: "https://cdn.example.com/avatar-2.mp4" }),
        ],
      },
      "avatar-focus",
    );

    const timeline = buildVisualTimeline(props);
    const avatarSegments = timeline.tracks.find((track) => track.id === "avatar")?.segments || [];

    assert.deepEqual(
      avatarSegments.map((segment) => segment.id),
      ["avatar-1", "avatar-2"],
    );
    assert.deepEqual(
      avatarSegments.map((segment) => segment.layerId),
      [getAvatarClipItemLayerId(1), getAvatarClipItemLayerId(2)],
    );
    assert.deepEqual(
      avatarSegments.map((segment) => segment.startFrame),
      [0, 2 * ASSEMBLY_FPS - AVATAR_CLIP_CROSSFADE_FRAMES],
    );
    assert.equal(
      avatarSegments[0].endFrame - avatarSegments[1].startFrame,
      AVATAR_CLIP_CROSSFADE_FRAMES,
    );
  });

  it("mirrors B-roll overlay timing when slides are present", () => {
    const props = buildAssemblyProps(
      {
        voice_audio: {
          public_url: AUDIO_URL,
          storage_path: "production-assets/voice.mp3",
          duration: 4,
        },
        slides: {
          images: [
            {
              public_url: IMAGE_URL,
              storage_path: "production-assets/slides/slide.png",
              slide_index: 0,
            },
          ],
        },
        b_roll_clips: [
          baseClip({
            public_url: "https://cdn.example.com/broll-1.mp4",
            duration: 1,
            order: 1,
          }),
          baseClip({
            id: "clip-2",
            public_url: "https://cdn.example.com/broll-2.mp4",
            duration: 1,
            order: 2,
          }),
        ],
      },
      ASSEMBLY_TEMPLATES.FULL_SLIDES,
    );

    const timeline = buildVisualTimeline(props);
    const brollSegments = timeline.tracks.find((track) => track.id === "broll")?.segments ?? [];

    assert.deepEqual(
      brollSegments.map((segment) => segment.startFrame),
      [20, 70],
    );
  });

  it("reports active segments for a selected frame", () => {
    const props = buildAssemblyProps(
      {
        voice_audio: {
          public_url: AUDIO_URL,
          storage_path: "production-assets/voice.mp3",
          duration: 4,
        },
        slides: {
          images: [
            {
              public_url: "https://cdn.example.com/slide-1.png",
              storage_path: "production-assets/slides/slide-1.png",
              slide_index: 0,
            },
            {
              public_url: "https://cdn.example.com/slide-2.png",
              storage_path: "production-assets/slides/slide-2.png",
              slide_index: 1,
            },
          ],
        },
      },
      ASSEMBLY_TEMPLATES.FULL_SLIDES,
    );

    const timeline = buildVisualTimeline(props);
    const activeAtStart = getActiveTimelineSegments(timeline, 0);
    const activeAtSecondHalf = getActiveTimelineSegments(timeline, 75);

    assert.deepEqual(
      activeAtStart.map((segment) => segment.id),
      ["voice", "slide-0"],
    );
    assert.deepEqual(
      activeAtSecondHalf.map((segment) => segment.id),
      ["voice", "slide-1"],
    );
  });

  it("applies slide timeline overrides after the uniform baseline", () => {
    const props = buildAssemblyProps(
      {
        voice_audio: {
          public_url: AUDIO_URL,
          storage_path: "production-assets/voice.mp3",
          duration: 6,
        },
        slides: {
          images: [
            {
              public_url: "https://cdn.example.com/slide-1.png",
              storage_path: "production-assets/slides/slide-1.png",
              slide_index: 0,
            },
            {
              public_url: "https://cdn.example.com/slide-2.png",
              storage_path: "production-assets/slides/slide-2.png",
              slide_index: 1,
            },
          ],
        },
      },
      ASSEMBLY_TEMPLATES.FULL_SLIDES,
      {},
      [],
      [
        {
          version: 1,
          timeline: { fps: ASSEMBLY_FPS, durationInFrames: 180 },
          segments: [
            {
              id: "slide-0",
              trackKind: "slides",
              layerId: getSlideItemLayerId(0),
              startFrame: 0,
              endFrame: 120,
              loopMode: "none",
            },
          ],
        },
      ],
    );

    const timeline = buildVisualTimeline(props);
    const slideSegments = timeline.tracks.find((track) => track.id === "slides")?.segments ?? [];

    assert.equal(slideSegments[0].durationInFrames, 120);
    assert.equal(slideSegments[1].startFrame, 90);
  });

  it("resolves slide render segments by layer id when override ids drift", () => {
    const items = resolveSlideTimelineRenderItems(
      [
        { animationCount: 0, index: 0, kind: "image", url: "https://cdn.example.com/slide-1.png" },
        { animationCount: 0, index: 1, kind: "image", url: "https://cdn.example.com/slide-2.png" },
      ],
      [
        {
          id: "legacy-slide-id",
          trackKind: "slides",
          layerId: getSlideItemLayerId(0),
          label: "Slide 1",
          startFrame: 45,
          endFrame: 120,
          durationInFrames: 75,
        },
      ],
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].slide.index, 0);
    assert.equal(items[0].segment.startFrame, 45);
  });

  it("applies B-roll trim and loop metadata", () => {
    const props = buildAssemblyProps(
      {
        voice_audio: {
          public_url: AUDIO_URL,
          storage_path: "production-assets/voice.mp3",
          duration: 8,
        },
        b_roll_clips: [baseClip({ duration: 2, order: 1 })],
      },
      ASSEMBLY_TEMPLATES.FULL_SLIDES,
      {},
      [],
      [
        {
          version: 1,
          timeline: { fps: ASSEMBLY_FPS, durationInFrames: 240 },
          segments: [
            {
              id: "broll-1",
              trackKind: "broll",
              layerId: getBrollItemLayerId(1),
              startFrame: 30,
              endFrame: 210,
              sourceStartFrame: 15,
              sourceEndFrame: 45,
              loopMode: "loop",
            },
          ],
        },
      ],
    );

    const timeline = buildVisualTimeline(props);
    const broll = timeline.tracks.find((track) => track.id === "broll")?.segments[0];

    assert.equal(broll?.startFrame, 30);
    assert.equal(broll?.durationInFrames, 180);
    assert.equal(broll?.sourceStartFrame, 15);
    assert.equal(broll?.sourceEndFrame, 45);
    assert.equal(broll?.sourceDurationInFrames, 60);
    assert.equal(broll?.loopMode, "loop");
  });

  it("accepts and applies avatar clip timeline overrides", () => {
    const parsed = safeParseTimelineOverrideManifests([
      {
        version: 1,
        timeline: { fps: ASSEMBLY_FPS, durationInFrames: 150 },
        segments: [
          {
            id: "avatar-2",
            trackKind: "avatar",
            layerId: REMOTION_EDITABLE_LAYERS.AVATAR,
            startFrame: 75,
            endFrame: 135,
            sourceStartFrame: 6,
            sourceEndFrame: 66,
            loopMode: "none",
          },
        ],
      },
    ]);

    assert.equal(parsed.success, true);

    const props = buildAssemblyProps(
      {
        avatar_generation_mode: "scene_clips",
        avatar_clips: [
          baseAvatarClip({ id: "avatar-clip-1", order: 1, duration: 2 }),
          baseAvatarClip({ id: "avatar-clip-2", order: 2, duration: 3 }),
        ],
      },
      ASSEMBLY_TEMPLATES.AVATAR_FOCUS,
      {},
      [],
      parsed.success ? parsed.data : [],
    );

    const timeline = buildVisualTimeline(props);
    const avatarSegments = timeline.tracks.find((track) => track.id === "avatar")?.segments ?? [];
    const movedAvatar = avatarSegments.find((segment) => segment.id === "avatar-2");

    assert.equal(movedAvatar?.startFrame, 75);
    assert.equal(movedAvatar?.endFrame, 135);
    assert.equal(movedAvatar?.durationInFrames, 60);
    assert.equal(movedAvatar?.sourceStartFrame, 6);
    assert.equal(movedAvatar?.sourceEndFrame, 66);
    assert.equal(movedAvatar?.loopMode, "none");
  });

  it("clamps timeline overrides to the composition duration", () => {
    const props = buildAssemblyProps(
      {
        voice_audio: {
          public_url: AUDIO_URL,
          storage_path: "production-assets/voice.mp3",
          duration: 4,
        },
        b_roll_clips: [baseClip({ duration: 2, order: 1 })],
      },
      ASSEMBLY_TEMPLATES.FULL_SLIDES,
      {},
      [],
      [
        {
          version: 1,
          timeline: { fps: ASSEMBLY_FPS, durationInFrames: 120 },
          segments: [
            {
              id: "broll-1",
              trackKind: "broll",
              startFrame: 90,
              endFrame: 999,
              sourceStartFrame: 0,
              sourceEndFrame: 999,
              loopMode: "loop",
            },
          ],
        },
      ],
    );

    const timeline = buildVisualTimeline(props);
    const broll = timeline.tracks.find((track) => track.id === "broll")?.segments[0];

    assert.equal(broll?.endFrame, 120);
    assert.equal(broll?.durationInFrames, 30);
    assert.equal(broll?.sourceEndFrame, 60);
  });

  it("keeps first and last slide layer ids addressable with many one-based slide assets", () => {
    const props = buildAssemblyProps(
      {
        voice_audio: {
          public_url: AUDIO_URL,
          storage_path: "production-assets/voice.mp3",
          duration: 48,
        },
        slides: {
          images: Array.from({ length: 24 }, (_, index) => ({
            public_url: `https://cdn.example.com/slide-${index + 1}.png`,
            storage_path: `production-assets/slides/slide-${index + 1}.png`,
            slide_index: index + 1,
          })),
        },
      },
      ASSEMBLY_TEMPLATES.FULL_SLIDES,
    );

    const timeline = buildVisualTimeline(props);
    const slideSegments = timeline.tracks.find((track) => track.id === "slides")?.segments ?? [];

    assert.equal(slideSegments.length, 24);
    assert.equal(slideSegments[0].layerId, getSlideItemLayerId(0));
    assert.equal(slideSegments[0].label, "Slide 1");
    assert.equal(slideSegments[23].layerId, getSlideItemLayerId(23));
    assert.equal(slideSegments[23].label, "Slide 24");
  });
});

describe("buildLayoutOverrideStyle", () => {
  it("returns an empty style when there are no edits for the layer", () => {
    const style = buildLayoutOverrideStyle([], REMOTION_EDITABLE_LAYERS.AVATAR);

    assert.deepEqual(style, {});
  });

  it("translates validated layer edits into safe inline styles", () => {
    const style = buildLayoutOverrideStyle(
      [
        {
          version: 1,
          canvas: { width: 1920, height: 1080, fps: ASSEMBLY_FPS },
          edits: [
            { layerId: "avatar", kind: "position", x: 100, y: 200 },
            { layerId: "avatar", kind: "size", width: 640, height: 360 },
            { layerId: "avatar", kind: "crop", top: 0.05, right: 0.1, bottom: 0, left: 0.15 },
            { layerId: "avatar", kind: "rotation", angle: 12 },
            { layerId: "avatar", kind: "stack", order: 30 },
          ],
        },
      ],
      REMOTION_EDITABLE_LAYERS.AVATAR,
    );

    assert.deepEqual(style, {
      position: "absolute",
      left: 100,
      top: 200,
      right: "auto",
      bottom: "auto",
      flex: "none",
      width: 640,
      height: 360,
      clipPath: "inset(5% 10% 0% 15%)",
      transform: "rotate(12deg)",
      zIndex: 30,
    });
  });

  it("keeps edits scoped to the requested layer", () => {
    const style = buildLayoutOverrideStyle(
      [
        {
          version: 1,
          canvas: { width: 1920, height: 1080 },
          edits: [
            { layerId: "primaryVisual", kind: "position", x: 24, y: 48 },
            { layerId: "avatar", kind: "position", x: 100, y: 200 },
          ],
        },
      ],
      REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL,
    );

    assert.equal(style.left, 24);
    assert.equal(style.top, 48);
  });

  it("applies later edits for the same layer deterministically", () => {
    const style = buildLayoutOverrideStyle(
      [
        {
          version: 1,
          canvas: { width: 1920, height: 1080 },
          edits: [
            { layerId: "avatar", kind: "position", x: 100, y: 200 },
            { layerId: "avatar", kind: "position", x: 300, y: 400 },
          ],
        },
      ],
      REMOTION_EDITABLE_LAYERS.AVATAR,
    );

    assert.equal(style.left, 300);
    assert.equal(style.top, 400);
  });

  it("ignores crop edits that would make the layer almost invisible", () => {
    const style = buildLayoutOverrideStyle(
      [
        {
          version: 1,
          canvas: { width: 1920, height: 1080 },
          edits: [
            { layerId: "avatar", kind: "crop", top: 0.95, right: 0, bottom: 0, left: 0.95 },
          ],
        },
      ],
      REMOTION_EDITABLE_LAYERS.AVATAR,
    );

    assert.equal(style.clipPath, "inset(0% 0% 0% 0%)");
  });
});

describe("layout override draft model", () => {
  it("exposes slides and b-roll as separate editable layers when both exist", () => {
    const layers = getEditableLayoutLayers(
      {
        hasAvatar: true,
        slideCount: 5,
        brollCount: 2,
      },
      [],
      ASSEMBLY_TEMPLATES.FULL_SLIDES,
    );

    assert.deepEqual(
      layers.map((layer) => layer.id),
      [
        REMOTION_EDITABLE_LAYERS.AVATAR,
        getSlideItemLayerId(0),
        getSlideItemLayerId(1),
        getSlideItemLayerId(2),
        getSlideItemLayerId(3),
        getSlideItemLayerId(4),
        getBrollItemLayerId(1),
        getBrollItemLayerId(2),
        REMOTION_EDITABLE_LAYERS.SLIDES,
        REMOTION_EDITABLE_LAYERS.BROLL,
        REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL,
      ],
    );
  });

  it("derives B-roll item boxes from the effective B-roll layer box", () => {
    const manifest = createEmptyLayoutOverrideManifest({
      componentId: "component-1",
      templateId: ASSEMBLY_TEMPLATES.FULL_SLIDES,
    });

    assert.deepEqual(
      getEffectiveLayoutLayerBox({
        manifest,
        layerId: getBrollItemLayerId(1),
        templateSlug: ASSEMBLY_TEMPLATES.FULL_SLIDES,
        assetSummary: { hasAvatar: false, slideCount: 3, brollCount: 1 },
      }),
      {
        x: 1219,
        y: 665,
        width: 653,
        height: 367,
      },
    );
  });

  it("derives split-avatar default boxes from the internal composition layout", () => {
    const primaryVisualBox = getDefaultLayoutLayerBox({
      layerId: REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL,
      templateSlug: ASSEMBLY_TEMPLATES.SPLIT_AVATAR,
    });
    const avatarBox = getDefaultLayoutLayerBox({
      layerId: REMOTION_EDITABLE_LAYERS.AVATAR,
      templateSlug: ASSEMBLY_TEMPLATES.SPLIT_AVATAR,
    });

    assert.deepEqual(primaryVisualBox, {
      x: 0,
      y: 0,
      width: ASSEMBLY_WIDTH / 2,
      height: ASSEMBLY_HEIGHT,
    });
    assert.deepEqual(avatarBox, {
      x: ASSEMBLY_WIDTH / 2,
      y: 0,
      width: ASSEMBLY_WIDTH / 2,
      height: ASSEMBLY_HEIGHT,
    });
  });

  it("derives avatar-focus support strip from template config", () => {
    const supportStripBox = getDefaultLayoutLayerBox({
      layerId: REMOTION_EDITABLE_LAYERS.SUPPORT_STRIP,
      templateSlug: ASSEMBLY_TEMPLATES.AVATAR_FOCUS,
      templateConfig: { supportStripHeight: 0.3 },
    });

    assert.deepEqual(supportStripBox, {
      x: 0,
      y: ASSEMBLY_HEIGHT * 0.7,
      width: ASSEMBLY_WIDTH,
      height: ASSEMBLY_HEIGHT * 0.3,
    });
  });

  it("uses custom template editable layer metadata before internal fallbacks", () => {
    const layers = getEditableLayoutLayers(
      {
        hasAvatar: true,
        slideCount: 3,
        brollCount: 1,
      },
      [
        {
          layerId: REMOTION_EDITABLE_LAYERS.AVATAR,
          label: "Avatar",
          kind: "avatar",
          defaultBox: { x: 0, y: 0, width: ASSEMBLY_WIDTH / 2, height: ASSEMBLY_HEIGHT },
          capabilities: {
            canMove: true,
            canResize: true,
            canCrop: true,
            canRotate: false,
            canHide: true,
            canReorder: true,
          },
          defaultStackOrder: 20,
          stackGroup: "root",
        },
      ],
    );
    const avatarBox = getDefaultLayoutLayerBox({
      layerId: REMOTION_EDITABLE_LAYERS.AVATAR,
      editableLayers: layers,
    });

    assert.deepEqual(avatarBox, {
      x: 0,
      y: 0,
      width: ASSEMBLY_WIDTH / 2,
      height: ASSEMBLY_HEIGHT,
    });
  });

  it("exposes avatar clips as individual editable layers", () => {
    const layers = getEditableLayoutLayers(
      {
        hasAvatar: true,
        avatarClipCount: 2,
        slideCount: 0,
        brollCount: 0,
      },
      [],
      ASSEMBLY_TEMPLATES.SPLIT_AVATAR,
    );

    assert.deepEqual(
      layers.map((layer) => layer.id),
      [getAvatarClipItemLayerId(1), getAvatarClipItemLayerId(2), REMOTION_EDITABLE_LAYERS.AVATAR],
    );
    assert.equal(layers[0]?.label, "Avatar 1");
    assert.equal(layers[2]?.label, "Todo el avatar");
  });

  it("expands avatar clip layers for legacy template metadata without an item pattern", () => {
    const capabilities = {
      canMove: true,
      canResize: true,
      canCrop: true,
      canRotate: false,
      canHide: true,
      canReorder: true,
    };
    const layers = getEditableLayoutLayers(
      {
        hasAvatar: true,
        avatarClipCount: 2,
        slideCount: 0,
        brollCount: 0,
      },
      [
        {
          layerId: "avatar",
          label: "Avatar",
          kind: "avatar",
          capabilities,
          defaultBox: { x: 960, y: 0, width: 960, height: 1080 },
          defaultStackOrder: 10,
          stackGroup: "root",
        },
      ],
      "custom-composition",
      { allowInternalFallback: false },
    );

    assert.deepEqual(
      layers.map((layer) => layer.id),
      ["avatar:1", "avatar:2", "avatar"],
    );
    assert.deepEqual(
      getDefaultLayoutLayerBox({
        layerId: getAvatarClipItemLayerId(1),
        editableLayers: layers,
      }),
      { x: 960, y: 0, width: 960, height: 1080 },
    );
  });

  it("does not invent editable layers for an external bundle without a layout contract", () => {
    const layers = getEditableLayoutLayers(
      { hasAvatar: true, slideCount: 3, brollCount: 1 },
      [],
      "custom-composition",
      { allowInternalFallback: false },
    );

    assert.deepEqual(layers, []);
  });

  it("expands item layers only when the external contract declares their patterns", () => {
    const capabilities = {
      canMove: true,
      canResize: true,
      canCrop: true,
      canRotate: false,
      canHide: true,
      canReorder: true,
    };
    const layers = getEditableLayoutLayers(
      { hasAvatar: true, avatarClipCount: 2, slideCount: 2, brollCount: 1 },
      [
        {
          layerId: "avatar",
          label: "Avatar",
          kind: "avatar",
          itemLayerIdPattern: "avatar:{order}",
          capabilities,
        },
        {
          layerId: "slides",
          label: "Diapositivas",
          kind: "slides",
          itemLayerIdPattern: "slide:{index}",
          capabilities,
        },
        {
          layerId: "broll",
          label: "B-roll",
          kind: "broll",
          itemLayerIdPattern: "broll:{order}",
          capabilities,
        },
      ],
      "custom-composition",
      { allowInternalFallback: false },
    );

    assert.deepEqual(
      layers.map((layer) => layer.id),
      ["avatar:1", "avatar:2", "avatar", "slide:0", "slide:1", "slides", "broll:1", "broll"],
    );
    const firstSlideLayer = layers.find((layer) => layer.id === "slide:0");
    assert.equal(firstSlideLayer?.canReorder, true);
    assert.equal(firstSlideLayer?.defaultStackOrder, 1);
    assert.equal(firstSlideLayer?.stackGroup, "slides-items");
  });

  it("filters external layout edits by declared layer capabilities", () => {
    const manifests = filterLayoutOverridesForEditableLayers(
      [
        {
          version: 1,
          canvas: { width: ASSEMBLY_WIDTH, height: ASSEMBLY_HEIGHT },
          edits: [
            { layerId: "slides", kind: "position", x: 960, y: 0 },
            { layerId: "slides", kind: "stack", order: 20 },
            { layerId: "slide:2", kind: "size", width: 400, height: 300 },
          ],
        },
      ],
      [
        {
          layerId: "slides",
          label: "Diapositivas",
          kind: "slides",
          capabilities: {
            canMove: true,
            canResize: true,
            canCrop: true,
            canRotate: false,
            canHide: true,
            canReorder: false,
          },
        },
      ],
    );

    assert.deepEqual(manifests[0]?.edits, [
      { layerId: "slides", kind: "position", x: 960, y: 0 },
    ]);
  });

  it("keeps avatar clip edits for legacy avatar layer contracts", () => {
    const manifests = filterLayoutOverridesForEditableLayers(
      [
        {
          version: 1,
          canvas: { width: ASSEMBLY_WIDTH, height: ASSEMBLY_HEIGHT },
          edits: [
            { layerId: getAvatarClipItemLayerId(1), kind: "position", x: 120, y: 40 },
            { layerId: getAvatarClipItemLayerId(2), kind: "size", width: 640, height: 360 },
          ],
        },
      ],
      [
        {
          layerId: "avatar",
          label: "Avatar",
          kind: "avatar",
          capabilities: {
            canMove: true,
            canResize: true,
            canCrop: true,
            canRotate: false,
            canHide: true,
            canReorder: true,
          },
        },
      ],
    );

    assert.deepEqual(
      manifests[0]?.edits.map((edit) => edit.layerId),
      [getAvatarClipItemLayerId(1), getAvatarClipItemLayerId(2)],
    );
  });

  it("accepts declared item patterns including stack when the contract allows it", () => {
    const manifests = filterLayoutOverridesForEditableLayers(
      [
        {
          version: 1,
          canvas: { width: ASSEMBLY_WIDTH, height: ASSEMBLY_HEIGHT },
          edits: [
            { layerId: "slide:2", kind: "size", width: 800, height: 450 },
            { layerId: "slide:2", kind: "stack", order: 90 },
            { layerId: "slide:wrong", kind: "position", x: 0, y: 0 },
          ],
        },
      ],
      [
        {
          layerId: "slides",
          label: "Diapositivas",
          kind: "slides",
          itemLayerIdPattern: "slide:{index}",
          capabilities: {
            canMove: true,
            canResize: true,
            canCrop: true,
            canRotate: false,
            canHide: true,
            canReorder: true,
          },
        },
      ],
    );

    assert.deepEqual(manifests[0]?.edits, [
      { layerId: "slide:2", kind: "size", width: 800, height: 450 },
      { layerId: "slide:2", kind: "stack", order: 90 },
    ]);
  });

  it("commits overlay box changes as position and size edits only", () => {
    const manifest = createEmptyLayoutOverrideManifest({
      componentId: "component-1",
      templateId: "template-1",
    });

    const nextManifest = commitLayoutLayerBox({
      manifest,
      layerId: REMOTION_EDITABLE_LAYERS.AVATAR,
      box: { x: 100.2, y: 200.7, width: 640.4, height: 360.1 },
    });

    assert.deepEqual(nextManifest.edits, [
      { layerId: REMOTION_EDITABLE_LAYERS.AVATAR, kind: "position", x: 100, y: 201 },
      { layerId: REMOTION_EDITABLE_LAYERS.AVATAR, kind: "size", width: 640, height: 360 },
    ]);
  });

  it("commits crop edits within safe visible bounds", () => {
    const manifest = createEmptyLayoutOverrideManifest({
      componentId: "component-1",
      templateId: "template-1",
    });

    const nextManifest = commitLayoutLayerCrop({
      manifest,
      layerId: REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL,
      crop: { top: 0.2, right: 0.9, bottom: 0.1, left: 0.4 },
    });

    assert.deepEqual(nextManifest.edits, [
      {
        layerId: REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL,
        kind: "crop",
        top: 0.2,
        right: 0.55,
        bottom: 0.1,
        left: 0.05,
      },
    ]);
  });

  it("resets extreme crop edits before they hide the preview", () => {
    const manifest = createEmptyLayoutOverrideManifest({
      componentId: "component-1",
      templateId: "template-1",
    });

    const nextManifest = commitLayoutLayerCrop({
      manifest,
      layerId: REMOTION_EDITABLE_LAYERS.AVATAR,
      crop: { top: 0.95, right: 0, bottom: 0, left: 0.95 },
    });

    assert.deepEqual(nextManifest.edits, [
      {
        layerId: REMOTION_EDITABLE_LAYERS.AVATAR,
        kind: "crop",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
    ]);
  });

  it("uses committed edits over default boxes", () => {
    const manifest = commitLayoutLayerBox({
      manifest: createEmptyLayoutOverrideManifest({
        componentId: "component-1",
        templateId: "template-1",
      }),
      layerId: REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL,
      box: { x: 12, y: 24, width: 800, height: 450 },
    });

    const effectiveBox = getEffectiveLayoutLayerBox({
      manifest,
      layerId: REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL,
      templateSlug: ASSEMBLY_TEMPLATES.FULL_SLIDES,
    });

    assert.deepEqual(effectiveBox, {
      x: 12,
      y: 24,
      width: 800,
      height: 450,
    });
  });

  it("moves reorderable layers one level without rewriting unrelated layers", () => {
    const manifest = createEmptyLayoutOverrideManifest({
      componentId: "component-1",
      templateId: "template-1",
    });
    const editableLayers = [
      { id: "slides", label: "Diapositivas", canReorder: true, defaultStackOrder: 10, stackGroup: "root" },
      { id: "avatar", label: "Avatar", canReorder: true, defaultStackOrder: 20, stackGroup: "root" },
      { id: "broll", label: "B-roll", canReorder: true, defaultStackOrder: 30, stackGroup: "root" },
    ];

    const reordered = moveLayoutLayerInStack({
      manifest,
      layerId: "avatar",
      editableLayers,
      direction: "forward",
    });

    assert.equal(reordered.edits.length, 2);
    assert.equal(
      getEffectiveLayoutLayerStackOrder(reordered, editableLayers[0]),
      10,
    );
    assert.equal(buildLayoutOverrideStyle([reordered], "broll").zIndex, 20);
    assert.equal(buildLayoutOverrideStyle([reordered], "avatar").zIndex, 30);
    assert.deepEqual(
      getLayoutLayerStackPosition({
        manifest: reordered,
        layerId: "avatar",
        editableLayers,
      }),
      { canMoveBackward: true, canMoveForward: false, index: 2, total: 3 },
    );
  });

  it("moves individual asset layers inside their own stack group", () => {
    const manifest = createEmptyLayoutOverrideManifest({
      componentId: "component-1",
      templateId: "template-1",
    });
    const editableLayers = [
      { id: "slide:0", label: "Diapositiva 1", canReorder: true, defaultStackOrder: 1, stackGroup: "slide-items" },
      { id: "slide:1", label: "Diapositiva 2", canReorder: true, defaultStackOrder: 2, stackGroup: "slide-items" },
      { id: "broll:1", label: "B-roll 1", canReorder: true, defaultStackOrder: 1, stackGroup: "broll-items" },
    ];

    const reordered = moveLayoutLayerInStack({
      manifest,
      layerId: "slide:0",
      editableLayers,
      direction: "forward",
    });

    assert.equal(buildLayoutOverrideStyle([reordered], "slide:0").zIndex, 2);
    assert.equal(buildLayoutOverrideStyle([reordered], "slide:1").zIndex, 1);
    assert.equal(buildLayoutOverrideStyle([reordered], "broll:1").zIndex, undefined);
    assert.deepEqual(
      getLayoutLayerStackPosition({
        manifest: reordered,
        layerId: "slide:0",
        editableLayers,
      }),
      { canMoveBackward: true, canMoveForward: false, index: 1, total: 2 },
    );
  });

  it("does not reorder locked layers or layers from another stack group", () => {
    const manifest = createEmptyLayoutOverrideManifest({
      componentId: "component-1",
      templateId: "template-1",
    });
    const editableLayers = [
      { id: "background", label: "Fondo", canReorder: false, defaultStackOrder: 0, stackGroup: "root" },
      { id: "slides", label: "Diapositivas", canReorder: true, defaultStackOrder: 10, stackGroup: "visual" },
      { id: "avatar", label: "Avatar", canReorder: true, defaultStackOrder: 20, stackGroup: "root" },
    ];

    assert.equal(
      moveLayoutLayerInStack({
        manifest,
        layerId: "background",
        editableLayers,
        direction: "forward",
      }),
      manifest,
    );
    assert.deepEqual(
      getLayoutLayerStackPosition({
        manifest,
        layerId: "avatar",
        editableLayers,
      }),
      { canMoveBackward: false, canMoveForward: false, index: 0, total: 1 },
    );
  });

  it("resets a reordered stack group without leaving duplicate levels", () => {
    const editableLayers = [
      { id: "slides", label: "Diapositivas", canReorder: true, defaultStackOrder: 10, stackGroup: "root" },
      { id: "avatar", label: "Avatar", canReorder: true, defaultStackOrder: 20, stackGroup: "root" },
      { id: "broll", label: "B-roll", canReorder: true, defaultStackOrder: 30, stackGroup: "root" },
    ];
    const reordered = moveLayoutLayerInStack({
      manifest: createEmptyLayoutOverrideManifest({
        componentId: "component-1",
        templateId: "template-1",
      }),
      layerId: "avatar",
      editableLayers,
      direction: "forward",
    });

    const reset = resetLayoutLayerToDefault({
      manifest: reordered,
      layerId: "avatar",
      editableLayers,
    });

    assert.equal(reset.edits.some((edit) => edit.kind === "stack"), false);
    assert.deepEqual(
      editableLayers.map((layer) => getEffectiveLayoutLayerStackOrder(reset, layer)),
      [10, 20, 30],
    );
  });
});

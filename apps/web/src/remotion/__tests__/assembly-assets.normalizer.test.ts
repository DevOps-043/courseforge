import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAssemblyProps, hasPreviewableAssets } from "../buildAssemblyProps";
import {
  getAssemblyAssetReadiness,
  normalizeAssemblyAssets,
} from "../assembly-assets.normalizer";
import { ASSEMBLY_FPS, safeParseAssemblyInputProps } from "../types";
import { DEFAULT_TEMPLATE_RENDER_CONFIG } from "../template-config";
import { buildBrollTimeline } from "../visual-timeline";
import { deriveAssemblyTargetDurationSeconds } from "../assembly-duration";
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

describe("normalizeAssemblyAssets", () => {
  it("sorts slide images by slide_index and keeps only renderable URLs", () => {
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
      [1, 2],
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
    assert.equal(
      readiness.warnings.some(
        (warning) => warning.code === "SLIDES_REFERENCE_NOT_RENDERIZABLE",
      ),
      true,
    );
    assert.equal(hasPreviewableAssets(assets), true);
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
    assert.equal(
      readiness.warnings.some(
        (warning) => warning.code === "SLIDES_REFERENCE_NOT_RENDERIZABLE",
      ),
      false,
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
    assert.equal(normalized.totalDurationSeconds, 11);
  });

  it("prioritizes voice duration over avatar, B-roll and slides", () => {
    const assets: MaterialAssets = {
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

  it("uses assembly target duration as a floor over shorter voice assets", () => {
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

    assert.equal(props.totalDurationInFrames, 170 * ASSEMBLY_FPS);
  });

  it("uses assembly target duration over long visual-only B-roll assets", () => {
    const props = buildAssemblyProps(
      {
        assembly_target_duration_seconds: 170,
        b_roll_clips: [baseClip({ duration: 31 * 60 })],
      },
      "full-slides",
    );

    assert.equal(props.totalDurationInFrames, 170 * ASSEMBLY_FPS);
  });

  it("derives target duration from generated video content hierarchy", () => {
    const duration = deriveAssemblyTargetDurationSeconds({
      duration_estimate_minutes: 2.5,
      script: {
        sections: [
          { duration_seconds: 40, timecode_start: "00:00", timecode_end: "00:40" },
          { duration_seconds: 50, timecode_start: "00:40", timecode_end: "01:30" },
        ],
      },
      storyboard: [
        { timecode_start: "00:00", timecode_end: "02:50" },
      ],
    });

    assert.equal(duration, 170);
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

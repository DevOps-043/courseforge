import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ASSEMBLY_FPS,
  buildAssemblyInputProps,
  hasPrimaryRenderableAssemblyAssets,
  normalizeAssemblyAssets,
  resolveExternalCompositionId,
  resolveCompositionId,
  resolveInternalCompositionId,
} from '../remotion-assembly-props.service';

const VIDEO_URL = 'https://cdn.example.com/video.mp4';
const AUDIO_URL = 'https://cdn.example.com/audio.mp3';
const IMAGE_URL = 'https://cdn.example.com/slide.png';

function baseClip(params: Record<string, unknown>) {
  return {
    id: params.id ?? 'clip',
    storage_path: params.storage_path ?? 'production-assets/broll/clip.mp4',
    public_url: params.public_url ?? VIDEO_URL,
    duration: params.duration,
    prompt_used: params.prompt_used,
    order: params.order ?? 1,
  };
}

describe('remotion assembly props contract', () => {
  it('keeps internal composition resolution scoped to known built-in IDs', () => {
    assert.equal(resolveInternalCompositionId('split-avatar'), 'split-avatar');
    assert.equal(resolveInternalCompositionId('CustomBundleSmokeTest'), 'full-slides');
    assert.equal(resolveCompositionId('CustomBundleSmokeTest'), 'full-slides');
  });

  it('preserves non-empty external bundle composition IDs', () => {
    assert.equal(resolveExternalCompositionId('CustomBundleSmokeTest'), 'CustomBundleSmokeTest');
    assert.equal(resolveExternalCompositionId('  CustomBundleSmokeTest  '), 'CustomBundleSmokeTest');
    assert.equal(resolveExternalCompositionId('', 'split-avatar'), 'split-avatar');
  });

  it('sorts slide images by slide_index', () => {
    const normalized = normalizeAssemblyAssets({
      slides: {
        images: [
          {
            slide_index: 2,
            storage_path: 'production-assets/slides/2.png',
            public_url: 'https://cdn.example.com/slide-2.png',
          },
          {
            slide_index: 1,
            storage_path: 'production-assets/slides/1.png',
            public_url: 'https://cdn.example.com/slide-1.png',
          },
        ],
      },
    });

    assert.deepEqual(
      normalized.slides.map((slide) => slide.index),
      [1, 2],
    );
    assert.equal(normalized.totalDurationSeconds, 10);
  });

  it('sorts multiple B-roll clips by order and applies default duration', () => {
    const normalized = normalizeAssemblyAssets({
      b_roll_clips: [
        baseClip({
          id: 'third',
          public_url: 'https://cdn.example.com/third.mp4',
          order: 3,
          duration: 2,
        }),
        baseClip({
          id: 'first',
          public_url: 'https://cdn.example.com/first.mp4',
          order: 1,
        }),
        baseClip({
          id: 'second',
          public_url: 'https://cdn.example.com/second.mp4',
          order: 2,
          duration: 4,
        }),
      ],
    });

    assert.deepEqual(
      normalized.brollClips.map((clip) => clip.url),
      [
        'https://cdn.example.com/first.mp4',
        'https://cdn.example.com/second.mp4',
        'https://cdn.example.com/third.mp4',
      ],
    );
    assert.deepEqual(
      normalized.brollClips.map((clip) => clip.durationInFrames),
      [150, 120, 60],
    );
    assert.equal(normalized.totalDurationSeconds, 11);
  });

  it('prioritizes voice duration over avatar, B-roll and slides', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'split-avatar',
      transitionType: 'none',
      assets: {
        voice_audio: {
          storage_path: 'production-assets/voice.mp3',
          public_url: AUDIO_URL,
          duration: 12,
        },
        avatar_video: {
          storage_path: 'production-assets/avatar.mp4',
          public_url: VIDEO_URL,
          duration: 30,
        },
        b_roll_clips: [baseClip({ duration: 20 })],
        slides: {
          images: [
            {
              slide_index: 1,
              storage_path: 'production-assets/slides/1.png',
              public_url: IMAGE_URL,
            },
          ],
        },
      },
    });

    assert.equal(props.template, 'split-avatar');
    assert.equal(props.transitionType, 'none');
    assert.equal(props.templateConfig.transitionType, 'none');
    assert.equal(props.totalDurationInFrames, 12 * ASSEMBLY_FPS);
    assert.equal(props.voiceAudioUrl, AUDIO_URL);
    assert.equal(props.avatarVideoUrl, VIDEO_URL);
  });

  it('prioritizes voice duration over assembly target duration', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      assets: {
        assembly_target_duration_seconds: 170,
        voice_audio: {
          storage_path: 'production-assets/voice.mp3',
          public_url: AUDIO_URL,
          duration: 51,
        },
      },
    });

    assert.equal(props.totalDurationInFrames, 51 * ASSEMBLY_FPS);
  });

  it('prioritizes visual asset duration over assembly target duration', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      assets: {
        assembly_target_duration_seconds: 170,
        b_roll_clips: [baseClip({ duration: 31 * 60 })],
      },
    });

    assert.equal(props.totalDurationInFrames, 31 * 60 * ASSEMBLY_FPS);
  });

  it('uses assembly target duration only when assets have no measurable duration', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      assets: {
        assembly_target_duration_seconds: 170,
        avatar_video: {
          storage_path: 'production-assets/avatar.mp4',
          public_url: VIDEO_URL,
        },
      },
    });

    assert.equal(props.totalDurationInFrames, 170 * ASSEMBLY_FPS);
  });

  it('uses assembly target duration before slide-count fallback', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      assets: {
        assembly_target_duration_seconds: 170,
        slides: {
          images: [
            { slide_index: 1, storage_path: 'slides/1.png', public_url: IMAGE_URL },
            { slide_index: 2, storage_path: 'slides/2.png', public_url: IMAGE_URL },
            { slide_index: 3, storage_path: 'slides/3.png', public_url: IMAGE_URL },
          ],
        },
      },
    });

    assert.equal(props.totalDurationInFrames, 170 * ASSEMBLY_FPS);
  });

  it('uses assembly target duration instead of a shorter avatar duration', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      assets: {
        assembly_target_duration_seconds: 170,
        avatar_video: {
          storage_path: 'production-assets/avatar.mp4',
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
    });

    assert.equal(props.totalDurationInFrames, 170 * ASSEMBLY_FPS);
  });

  it('uses assembly target duration before default B-roll fallback durations', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      assets: {
        assembly_target_duration_seconds: 170,
        b_roll_clips: [baseClip({ duration: undefined })],
      },
    });

    assert.equal(props.totalDurationInFrames, 170 * ASSEMBLY_FPS);
  });

  it('rejects empty assets instead of producing a blank fallback video', () => {
    assert.equal(hasPrimaryRenderableAssemblyAssets({}), false);
    assert.throws(
      () => buildAssemblyInputProps({
        compositionId: resolveCompositionId('unknown-template'),
        transitionType: 'zoom',
        assets: {},
      }),
      /No hay assets renderizables/,
    );
  });

  it('uses safe fallbacks for unknown composition and transition when assets exist', () => {
    const props = buildAssemblyInputProps({
      compositionId: resolveCompositionId('unknown-template'),
      transitionType: 'zoom',
      assets: {
        voice_audio: {
          storage_path: 'production-assets/voice.mp3',
          public_url: AUDIO_URL,
          duration: 10,
        },
      },
    });

    assert.equal(props.template, 'full-slides');
    assert.equal(props.transitionType, 'fade');
    assert.equal(props.totalDurationInFrames, 10 * ASSEMBLY_FPS);
    assert.deepEqual(props.slides, []);
    assert.deepEqual(props.brollClips, []);
  });

  it('combines template config with assembly props', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      templateConfig: {
        accentColor: '#ff00aa',
        backgroundColor: '#101010',
        transitionType: 'slide',
        avatarScale: 0.3,
      },
      assets: {
        voice_audio: {
          storage_path: 'production-assets/voice.mp3',
          public_url: AUDIO_URL,
          duration: 10,
        },
      },
    });

    assert.equal(props.transitionType, 'slide');
    assert.equal(props.templateConfig.accentColor, '#ff00aa');
    assert.equal(props.templateConfig.backgroundColor, '#101010');
    assert.equal(props.templateConfig.avatarScale, 0.3);
  });

  it('falls back from invalid template config values', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      templateConfig: {
        accentColor: 'red',
        transitionType: 'zoom',
        avatarScale: 99,
      },
      assets: {
        voice_audio: {
          storage_path: 'production-assets/voice.mp3',
          public_url: AUDIO_URL,
          duration: 10,
        },
      },
    });

    assert.equal(props.transitionType, 'fade');
    assert.equal(props.templateConfig.accentColor, '#00D4B3');
    assert.equal(props.templateConfig.avatarScale, 0.24);
  });
});

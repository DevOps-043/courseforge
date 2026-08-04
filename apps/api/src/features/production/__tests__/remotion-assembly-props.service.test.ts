import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AVATAR_CLIP_CROSSFADE_FRAMES,
  ASSEMBLY_FPS,
  buildAssemblyInputProps,
  hasPrimaryRenderableAssemblyAssets,
  normalizeAssemblyAssets,
  resolveExternalCompositionId,
  resolveCompositionId,
  resolveInternalCompositionId,
} from '../remotion-assembly-props.service';
import { parseLayoutOverrideManifests } from '../layout-overrides.service';
import { parseTimelineOverrideManifests } from '../timeline-overrides.service';

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

function baseAvatarClip(params: Record<string, unknown>) {
  return {
    id: params.id ?? 'avatar-clip',
    storage_path: params.storage_path ?? 'production-assets/avatar/clip.mp4',
    public_url: params.public_url ?? VIDEO_URL,
    duration: params.duration,
    order: params.order ?? 1,
    status: params.status ?? 'COMPLETED',
    deleted: params.deleted,
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

  it('sorts slide images by slide_index and normalizes them to contiguous layer indexes', () => {
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
      [0, 1],
    );
    assert.deepEqual(
      normalized.slides.map((slide) => slide.url),
      [
        'https://cdn.example.com/slide-1.png',
        'https://cdn.example.com/slide-2.png',
      ],
    );
    assert.equal(normalized.totalDurationSeconds, 10);
  });

  it('normalizes animated deck slides for render-safe HTML props', () => {
    const normalized = normalizeAssemblyAssets({
      slides: {
        animated_deck: {
          status: 'READY_FOR_RENDER',
          css: '.deck-scope .slide { width: 1920px; height: 1080px; }',
          fonts: [],
          slides: [
            {
              animationCount: 1,
              classes: 'slide s-center',
              html: '<h1>Pantalla de tÃ­tulo</h1>',
              index: 1,
              label: '01 Intro',
            },
          ],
        },
      },
    });

    assert.equal(normalized.slides[0].classes, 'slide s-center active');
    assert.equal(normalized.slides[0].html, '<h1>Pantalla de título</h1>');
    assert.equal(normalized.slides[0].kind, 'html');
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
    assert.equal(normalized.totalDurationSeconds, 6);
  });

  it('uses overlapping avatar clip duration when scene mode is active', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'avatar-focus',
      transitionType: 'none',
      assets: {
        avatar_generation_mode: 'scene_clips',
        avatar_clips: [
          baseAvatarClip({ id: 'second', order: 2, duration: 3, public_url: 'https://cdn.example.com/avatar-2.mp4' }),
          baseAvatarClip({ id: 'first', order: 1, duration: 2, public_url: 'https://cdn.example.com/avatar-1.mp4' }),
        ],
        avatar_video: {
          storage_path: 'production-assets/avatar.mp4',
          public_url: VIDEO_URL,
          duration: 90,
        },
      },
    });

    assert.equal(
      props.totalDurationInFrames,
      5 * ASSEMBLY_FPS - AVATAR_CLIP_CROSSFADE_FRAMES,
    );
    assert.deepEqual(
      props.avatarClips.map((clip) => clip.url),
      ['https://cdn.example.com/avatar-1.mp4', 'https://cdn.example.com/avatar-2.mp4'],
    );
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

  it('prefers measured voice duration over assembly target duration', () => {
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

  it('prefers measured B-roll duration over assembly target duration', () => {
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

  it('uses assembly target duration when assets have no measurable duration', () => {
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

  it('prefers slide-count duration over assembly target duration', () => {
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

    assert.equal(props.totalDurationInFrames, 3 * 5 * ASSEMBLY_FPS);
  });

  it('prefers measured avatar duration over assembly target duration', () => {
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

    assert.equal(props.totalDurationInFrames, 51 * ASSEMBLY_FPS);
  });

  it('prefers default B-roll fallback duration over assembly target duration', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      assets: {
        assembly_target_duration_seconds: 170,
        b_roll_clips: [baseClip({ duration: undefined })],
      },
    });

    assert.equal(props.totalDurationInFrames, 5 * ASSEMBLY_FPS);
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

  it('defaults layout overrides to an empty list', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      assets: {
        voice_audio: {
          storage_path: 'production-assets/voice.mp3',
          public_url: AUDIO_URL,
          duration: 10,
        },
      },
    });

    assert.deepEqual(props.layoutOverrides, []);
    assert.deepEqual(props.timelineOverrides, []);
  });

  it('passes validated layout overrides into server render props', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      layoutOverrides: [
        {
          version: 1,
          templateId: 'full-slides',
          componentId: 'component-1',
          canvas: { width: 1920, height: 1080, fps: ASSEMBLY_FPS },
          edits: [
            { layerId: 'avatar', kind: 'position', x: 1280, y: 620 },
            { layerId: 'primaryVisual', kind: 'size', width: 720, height: 405 },
            { layerId: 'avatar', kind: 'stack', order: 30 },
          ],
        },
      ],
      assets: {
        voice_audio: {
          storage_path: 'production-assets/voice.mp3',
          public_url: AUDIO_URL,
          duration: 10,
        },
      },
    });

    assert.equal(props.layoutOverrides.length, 1);
    assert.equal(props.layoutOverrides[0].edits.length, 3);
  });

  it('passes validated timeline overrides into server render props', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      timelineOverrides: [
        {
          version: 1,
          templateId: 'full-slides',
          componentId: 'component-1',
          timeline: { fps: ASSEMBLY_FPS, durationInFrames: 300 },
          segments: [
            {
              id: 'broll-1',
              trackKind: 'broll',
              layerId: 'broll:1',
              startFrame: 30,
              endFrame: 75,
              sourceStartFrame: 0,
              sourceEndFrame: 90,
              loopMode: 'loop',
            },
          ],
        },
      ],
      assets: {
        b_roll_clips: [baseClip({ duration: 3 })],
      },
    });

    assert.equal(props.timelineOverrides.length, 1);
    assert.equal(props.timelineOverrides[0].timeline.durationInFrames, 3 * ASSEMBLY_FPS);
    assert.equal(props.timelineOverrides[0].segments[0].startFrame, 30);
    assert.equal(props.timelineOverrides[0].segments[0].endFrame, 75);
    assert.equal(props.totalDurationInFrames, 3 * ASSEMBLY_FPS);
  });

  it('uses persisted asset timeline overrides when variables omit them', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      assets: {
        b_roll_clips: [baseClip({ duration: 3 })],
        timeline_overrides: [
          {
            version: 1,
            templateId: 'full-slides',
            componentId: 'component-1',
            timeline: { fps: ASSEMBLY_FPS, durationInFrames: 300 },
            segments: [
              {
                id: 'broll-1',
                trackKind: 'broll',
                startFrame: 15,
                endFrame: 75,
              },
            ],
          },
        ],
      },
    });

    assert.equal(props.timelineOverrides[0].timeline.durationInFrames, 3 * ASSEMBLY_FPS);
    assert.equal(props.timelineOverrides[0].segments[0].startFrame, 15);
    assert.equal(props.totalDurationInFrames, 3 * ASSEMBLY_FPS);
  });

  it('uses assembly target duration over a stale timeline manifest when no asset duration is measurable', () => {
    const props = buildAssemblyInputProps({
      compositionId: 'full-slides',
      transitionType: undefined,
      assets: {
        assembly_target_duration_seconds: 42,
        avatar_video: {
          storage_path: 'production-assets/avatar.mp4',
          public_url: VIDEO_URL,
        },
        timeline_overrides: [
          {
            version: 1,
            templateId: 'full-slides',
            componentId: 'component-1',
            timeline: { fps: ASSEMBLY_FPS, durationInFrames: 9 * 60 * ASSEMBLY_FPS },
            segments: [
              {
                id: 'broll-1',
                trackKind: 'broll',
                startFrame: 30,
                endFrame: 120,
              },
            ],
          },
        ],
      },
    });

    assert.equal(props.totalDurationInFrames, 42 * ASSEMBLY_FPS);
    assert.equal(props.timelineOverrides[0].timeline.durationInFrames, 42 * ASSEMBLY_FPS);
  });

  it('rejects invalid timeline ranges', () => {
    assert.throws(
      () => parseTimelineOverrideManifests([
        {
          version: 1,
          timeline: { fps: ASSEMBLY_FPS, durationInFrames: 300 },
          segments: [
            {
              id: 'broll-1',
              trackKind: 'broll',
              startFrame: 270,
              endFrame: 180,
            },
          ],
        },
      ]),
      /Timeline segment endFrame/,
    );
  });

  it('rejects arbitrary style data in layout overrides', () => {
    assert.throws(
      () => parseLayoutOverrideManifests([
        {
          version: 1,
          canvas: { width: 1920, height: 1080 },
          edits: [
            {
              layerId: 'avatar',
              kind: 'position',
              x: 10,
              y: 20,
              css: 'position:fixed;inset:0',
            },
          ],
        },
      ]),
      /Unrecognized key|unrecognized_keys/,
    );
  });

  it('rejects layout overrides outside safe bounds', () => {
    assert.throws(
      () => parseLayoutOverrideManifests([
        {
          version: 1,
          canvas: { width: 1920, height: 1080 },
          edits: [{ layerId: 'avatar', kind: 'size', width: -1, height: 405 }],
        },
      ]),
    );
  });

  it('rejects layout stack levels outside safe bounds', () => {
    assert.throws(
      () => parseLayoutOverrideManifests([
        {
          version: 1,
          canvas: { width: 1920, height: 1080 },
          edits: [{ layerId: 'avatar', kind: 'stack', order: 1001 }],
        },
      ]),
    );
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

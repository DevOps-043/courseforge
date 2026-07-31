import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildExternalTemplateProps,
  validatePropsSchema,
} from '../external-template-props.service';

const assets = {
  slides: {
    images: [
      { slide_index: 2, public_url: 'https://cdn.example.com/slide-2.png' },
      { slide_index: 1, public_url: 'https://cdn.example.com/slide-1.png' },
    ],
  },
  voice_audio: {
    public_url: 'https://cdn.example.com/voice.mp3',
    duration: 12,
  },
  avatar_video: {
    public_url: 'https://cdn.example.com/avatar.mp4',
  },
};

describe('external template props contract', () => {
  it('merges bundle defaults, Courseforge props and user overrides deterministically', () => {
    const result = buildExternalTemplateProps({
      assets,
      compositionId: 'external-main',
      bundleDefaultProps: {
        title: 'Bundle default',
        accentColor: '#111111',
      },
      variables: {
        timelineOverrides: [
          {
            version: 1,
            templateId: 'external-main',
            componentId: 'component-1',
            timeline: { fps: 30, durationInFrames: 360 },
            segments: [
              {
                id: 'broll-1',
                trackKind: 'broll',
                startFrame: 120,
                endFrame: 180,
              },
            ],
          },
        ],
        templateProps: {
          title: 'User override',
        },
      },
    });

    assert.equal(result.resolvedProps.title, 'User override');
    assert.equal(result.resolvedProps.accentColor, '#111111');
    assert.equal(result.resolvedProps.template, 'external-main');
    assert.equal(result.resolvedProps.voiceAudioUrl, 'https://cdn.example.com/voice.mp3');
    assert.deepEqual(result.resolvedProps.slides, [
      { index: 0, url: 'https://cdn.example.com/slide-1.png' },
      { index: 1, url: 'https://cdn.example.com/slide-2.png' },
    ]);
    assert.equal((result.resolvedProps.timelineOverrides as any[])[0].segments[0].startFrame, 120);
    assert.match(result.propsHash, /^[a-f0-9]{64}$/);
    assert.equal(result.propsSource, 'courseforge-canonical-v1');
    assert.equal(result.propKeys.includes('slides'), true);
  });

  it('promotes template render config to top-level props for external bundles', () => {
    const result = buildExternalTemplateProps({
      assets,
      compositionId: 'external-main',
      templateDefaultConfig: {
        accentColor: '#ff00aa',
        backgroundColor: '#101010',
        surfaceColor: '#222222',
      },
      bundleDefaultProps: {
        title: 'Bundle default',
        accentColor: '#111111',
      },
    });

    assert.equal(result.resolvedProps.accentColor, '#ff00aa');
    assert.equal(result.resolvedProps.backgroundColor, '#101010');
    assert.equal(result.resolvedProps.surfaceColor, '#222222');
    assert.equal((result.resolvedProps.templateConfig as any).accentColor, '#ff00aa');
  });

  it('keeps explicit template prop overrides above promoted render config', () => {
    const result = buildExternalTemplateProps({
      assets,
      compositionId: 'external-main',
      templateDefaultConfig: {
        accentColor: '#ff00aa',
      },
      variables: {
        templateProps: {
          accentColor: '#123456',
        },
      },
    });

    assert.equal(result.resolvedProps.accentColor, '#123456');
  });

  it('does not let template prop overrides replace canonical assembly props', () => {
    const result = buildExternalTemplateProps({
      assets: {
        ...assets,
        assembly_target_duration_seconds: 42,
      },
      compositionId: 'external-main',
      variables: {
        timelineOverrides: [
          {
            version: 1,
            templateId: 'external-main',
            componentId: 'component-1',
            timeline: { fps: 30, durationInFrames: 9 * 60 * 30 },
            segments: [
              {
                id: 'slide-0',
                trackKind: 'slides',
                layerId: 'slide:0',
                startFrame: 30,
                endFrame: 120,
              },
            ],
          },
        ],
        templateProps: {
          title: 'Allowed title',
          totalDurationInFrames: 9 * 60 * 30,
          slides: [],
          brollClips: [],
          timelineOverrides: [],
        },
      },
    });

    assert.equal(result.resolvedProps.title, 'Allowed title');
    assert.equal(result.resolvedProps.totalDurationInFrames, 12 * 30);
    assert.deepEqual(result.resolvedProps.slides, [
      { index: 0, url: 'https://cdn.example.com/slide-1.png' },
      { index: 1, url: 'https://cdn.example.com/slide-2.png' },
    ]);
    assert.equal((result.resolvedProps.timelineOverrides as any[])[0].timeline.durationInFrames, 12 * 30);
    assert.equal((result.resolvedProps.timelineOverrides as any[])[0].segments[0].startFrame, 30);
  });

  it('fails with a stable code when required props are missing', () => {
    assert.throws(
      () => validatePropsSchema(
        { slides: [] },
        { type: 'object', required: ['voiceAudioUrl'] },
      ),
      /EXTERNAL_PROPS_INVALID/,
    );
  });

  it('fails with a stable code when prop types do not match the schema', () => {
    assert.throws(
      () => validatePropsSchema(
        { slides: 'not-an-array' },
        { type: 'object', properties: { slides: { type: 'array' } } },
      ),
      /EXTERNAL_PROPS_INVALID/,
    );
  });
});

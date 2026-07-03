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
      { index: 1, url: 'https://cdn.example.com/slide-1.png' },
      { index: 2, url: 'https://cdn.example.com/slide-2.png' },
    ]);
    assert.match(result.propsHash, /^[a-f0-9]{64}$/);
    assert.equal(result.propsSource, 'courseforge-canonical-v1');
    assert.equal(result.propKeys.includes('slides'), true);
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

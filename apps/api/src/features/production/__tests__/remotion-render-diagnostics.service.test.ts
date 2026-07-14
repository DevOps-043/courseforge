import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildRenderDiagnosticsSnapshot,
  classifyRemotionFailure,
} from '../remotion-render-diagnostics.service';

describe('remotion render diagnostics', () => {
  it('classifies timeouts by execution boundary', () => {
    assert.equal(
      classifyRemotionFailure('Render timed out after 840000ms', { provider: 'lambda' }),
      'LAMBDA_TIMEOUT',
    );
    assert.equal(
      classifyRemotionFailure('selectComposition timeout', { provider: 'local' }),
      'LOCAL_RENDER_TIMEOUT',
    );
    assert.equal(
      classifyRemotionFailure('preview render timed out', { provider: 'preview' }),
      'EXTERNAL_PREVIEW_TIMEOUT',
    );
    assert.equal(
      classifyRemotionFailure('timeout while validating CodeBuild bundle', { provider: 'codebuild' }),
      'CODEBUILD_TIMEOUT',
    );
  });

  it('keeps render diagnostics useful without copying media URLs', () => {
    const snapshot = buildRenderDiagnosticsSnapshot({
      renderProvider: 'lambda',
      renderMode: 'EXTERNAL_LAMBDA_SITE_READY',
      templateId: 'template-1',
      templateVersionId: 'version-1',
      buildId: 'build-1',
      bundleHash: 'a'.repeat(64),
      buildHash: 'b'.repeat(64),
      compositionId: 'courseforge-template',
      propsHash: 'c'.repeat(64),
      timeoutInMilliseconds: 840000,
      lambdaTuning: { framesPerLambda: 600, concurrencyPerLambda: 1 },
      inputProps: {
        template: 'courseforge-template',
        fps: 30,
        totalDurationInFrames: 5130,
        voiceAudioUrl: 'https://cdn.example.com/voice.mp3',
        avatarVideoUrl: 'https://cdn.example.com/avatar.mp4',
        slides: [{ index: 1, url: 'https://cdn.example.com/slide.png' }],
        brollClips: [{ order: 1, url: 'https://cdn.example.com/broll.mp4' }],
      },
      rawAssets: {
        voice_audio: { public_url: 'https://cdn.example.com/voice.mp3', duration: 171 },
        avatar_video: { public_url: 'https://cdn.example.com/avatar.mp4', duration: 171 },
        slides: { images: [{ public_url: 'https://cdn.example.com/slide.png' }] },
        b_roll_clips: [{ public_url: 'https://cdn.example.com/broll.mp4' }],
      },
    });

    const props = snapshot.props as Record<string, unknown>;
    const assets = snapshot.assets as Record<string, unknown>;
    const serialized = JSON.stringify(snapshot);

    assert.equal(props.totalDurationInFrames, 5130);
    assert.equal(props.totalDurationSeconds, 171);
    assert.equal(props.slideCount, 1);
    assert.equal(assets.voiceDurationSeconds, 171);
    assert.equal(assets.brollClipCount, 1);
    assert.equal(snapshot.bundleHash, 'a'.repeat(16));
    assert.equal(serialized.includes('https://cdn.example.com'), false);
  });
});

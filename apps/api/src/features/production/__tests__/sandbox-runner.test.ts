import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { adaptToExternalTemplateProps } from '../sandbox-runner/props-adapter';
import { sandboxBundleCacheInternals } from '../sandbox-runner/bundle-cache';
import { rewritePreviewHtmlAssetPaths } from '../preview-html.service';

describe('sandbox runner utilities', () => {
  it('adapts internal assembly props to the external template contract', () => {
    const adapted = adaptToExternalTemplateProps({
      slides: [{ index: 1, url: 'https://cdn.example.com/slide.png' }],
      brollClips: [{ order: 1, url: 'https://cdn.example.com/broll.mp4', durationInFrames: 90 }],
      avatarVideoUrl: 'https://cdn.example.com/avatar.mp4',
      voiceAudioUrl: 'https://cdn.example.com/voice.mp3',
      bgMusicVolume: 0.2,
      fps: 24,
      totalDurationInFrames: 240,
      templateConfig: { accentColor: '#00D4B3' },
    });

    assert.deepEqual(adapted.slides, [{ index: 1, url: 'https://cdn.example.com/slide.png' }]);
    assert.deepEqual(adapted.brollClips, [
      { order: 1, url: 'https://cdn.example.com/broll.mp4', durationInFrames: 90 },
    ]);
    assert.equal(adapted.avatarVideoUrl, 'https://cdn.example.com/avatar.mp4');
    assert.equal(adapted.voiceAudioUrl, 'https://cdn.example.com/voice.mp3');
    assert.equal(adapted.bgMusicVolume, 0.2);
    assert.equal(adapted.fps, 24);
    assert.equal(adapted.totalDurationInFrames, 240);
    assert.deepEqual(adapted.templateConfig, { accentColor: '#00D4B3' });
  });

  it('uses safe defaults when optional props are malformed', () => {
    const adapted = adaptToExternalTemplateProps({
      slides: 'bad',
      brollClips: null,
      bgMusicVolume: Number.NaN,
      fps: '30',
      templateConfig: null,
    });

    assert.deepEqual(adapted.slides, []);
    assert.deepEqual(adapted.brollClips, []);
    assert.equal(adapted.bgMusicVolume, 0.15);
    assert.equal(adapted.fps, 30);
    assert.deepEqual(adapted.templateConfig, {});
  });

  it('rejects ZIP entries that resolve outside the extraction directory', () => {
    assert.throws(
      () => sandboxBundleCacheInternals.resolveInsideDirectory('/tmp/courseforge/extracted', '../escape.tsx'),
      /Path traversal/,
    );
  });

  it('keeps sandbox cache segments short for Windows paths', () => {
    const segment = sandboxBundleCacheInternals.toSafeCacheSegment(
      [
        'alternating-focus-v1',
        'component',
        'default-duration',
        'default-fps',
        'default-width',
        'default-height',
      ].join(':'),
    );

    assert.match(segment, /^[a-f0-9]{32}$/);
  });

  it('rewrites root-relative Remotion bundle assets to the preview build route', () => {
    const html = '<html><head><link href="/favicon.ico"></head><body><script src="/bundle.js"></script></body></html>';
    const rewritten = rewritePreviewHtmlAssetPaths(
      html,
      '4ff9cc6c-e562-4449-bd06-fbf510a7bb65',
      'alternating-focus-v1',
    );

    assert.match(
      rewritten,
      /src="\/api\/v1\/production\/remotion\/external-preview-bundles\/4ff9cc6c-e562-4449-bd06-fbf510a7bb65\/bundle\.js"/,
    );
    assert.match(
      rewritten,
      /href="\/api\/v1\/production\/remotion\/external-preview-bundles\/4ff9cc6c-e562-4449-bd06-fbf510a7bb65\/favicon\.ico"/,
    );
    assert.match(rewritten, /history\.replaceState/);
    assert.match(rewritten, /alternating-focus-v1/);
  });

  it('returns the original template entry point for root export mode', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'courseforge-root-entry-'));
    try {
      const entryPointPath = path.join(tmpDir, 'src', 'index.tsx');
      await fsp.mkdir(path.dirname(entryPointPath), { recursive: true });
      await fsp.writeFile(entryPointPath, 'registerRoot(Root);', 'utf8');

      const resolvedEntryPoint = await sandboxBundleCacheInternals.writeGeneratedRemotionEntry({
        extractedDir: tmpDir,
        templateEntryPointPath: entryPointPath,
        compositionId: 'CustomBundleSmokeTest',
        exportMode: 'root',
      });

      assert.equal(resolvedEntryPoint, entryPointPath);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('generates a component-mode wrapper with explicit composition metadata', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'courseforge-component-entry-'));
    try {
      const entryPointPath = path.join(tmpDir, 'src', 'index.tsx');
      await fsp.mkdir(path.dirname(entryPointPath), { recursive: true });
      await fsp.writeFile(entryPointPath, 'export default function Template() { return null; }', 'utf8');

      const generatedEntryPath = await sandboxBundleCacheInternals.writeGeneratedRemotionEntry({
        extractedDir: tmpDir,
        templateEntryPointPath: entryPointPath,
        compositionId: 'CustomBundleSmokeTest',
        exportMode: 'component',
        defaultDurationInFrames: 90,
        defaultFps: 24,
        defaultWidth: 1280,
        defaultHeight: 720,
      });
      const generatedSource = await fsp.readFile(generatedEntryPath, 'utf8');

      assert.match(generatedSource, /id=\{"CustomBundleSmokeTest"\}/);
      assert.match(generatedSource, /durationInFrames=\{90\}/);
      assert.match(generatedSource, /fps=\{24\}/);
      assert.match(generatedSource, /width=\{1280\}/);
      assert.match(generatedSource, /height=\{720\}/);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

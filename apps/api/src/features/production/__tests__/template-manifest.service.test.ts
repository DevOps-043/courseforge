import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import JSZip from 'jszip';
import { readManifestFromZipBuffer } from '../template-manifest.service';

async function zipBuffer(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });
  return Buffer.from(arrayBuffer);
}

describe('template manifest reader', () => {
  it('reads custom bundle render metadata from the ZIP manifest', async () => {
    const buffer = await zipBuffer({
      'courseforge-remotion-template.json': JSON.stringify({
        entryPoint: 'src/index.tsx',
        compositionId: 'CustomBundleSmokeTest',
        compositionIds: ['CustomBundleSmokeTest', 'AltComposition'],
        exportMode: 'root',
        defaultDurationFrames: 90,
        fps: 30,
        width: 1920,
        height: 1080,
        propsSchema: { type: 'object' },
        defaultProps: { title: 'Courseforge' },
      }),
      'src/index.tsx': 'export const Root = () => null;',
    });

    const result = await readManifestFromZipBuffer(buffer);

    assert.equal(result.error, null);
    assert.equal(result.manifest?.entryPoint, 'src/index.tsx');
    assert.equal(result.manifest?.compositionId, 'CustomBundleSmokeTest');
    assert.deepEqual(result.manifest?.compositionIds, ['CustomBundleSmokeTest', 'AltComposition']);
    assert.equal(result.manifest?.exportMode, 'root');
    assert.equal(result.manifest?.defaultDurationFrames, 90);
    assert.equal(result.manifest?.fps, 30);
    assert.equal(result.manifest?.width, 1920);
    assert.equal(result.manifest?.height, 1080);
    assert.deepEqual(result.manifest?.propsSchema, { type: 'object' });
    assert.deepEqual(result.manifest?.defaultProps, { title: 'Courseforge' });
  });

  it('returns a validation error when the manifest is missing', async () => {
    const buffer = await zipBuffer({
      'src/index.tsx': 'export const Root = () => null;',
    });

    const result = await readManifestFromZipBuffer(buffer);

    assert.equal(result.manifest, null);
    assert.match(result.error || '', /no encontrado/);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getExternalLambdaReadiness,
  isExternalLambdaReadyBuild,
  resolveExternalLambdaRenderTarget,
} from '../external-lambda-render-target.service';

describe('external lambda render target', () => {
  it('uses the cloud build serveUrl and external composition without internal fallback', () => {
    const target = resolveExternalLambdaRenderTarget({
      jobSnapshot: {
        templateVersionId: 'version-1',
        buildId: 'build-1',
      },
      version: {
        id: 'version-1',
        bundle_hash: 'bundle-hash',
        composition_id: 'external-main',
        export_mode: 'component',
      },
      build: {
        id: 'build-1',
        status: 'BUILT',
        serve_url: 'https://cdn.example.com/template/index.html',
        composition_id: 'external-main',
        build_hash: 'build-hash',
        cloud_provider: 'aws-codebuild',
      },
    });

    assert.equal(target.serveUrl, 'https://cdn.example.com/template/index.html');
    assert.equal(target.compositionId, 'external-main');
    assert.equal(target.templateVersionId, 'version-1');
    assert.equal(target.buildId, 'build-1');
    assert.equal(target.buildHash, 'build-hash');
    assert.equal(target.cloudProvider, 'aws-codebuild');
  });

  it('rejects a built record that is missing an external composition id', () => {
    assert.throws(
      () => resolveExternalLambdaRenderTarget({
        jobSnapshot: {
          templateVersionId: 'version-1',
          buildId: 'build-1',
        },
        version: { id: 'version-1' },
        build: {
          id: 'build-1',
          status: 'BUILT',
          serve_url: 'https://cdn.example.com/template/index.html',
        },
      }),
      /EXTERNAL_COMPOSITION_ID_MISSING/,
    );
  });

  it('requires a Lambda-ready build before external render', () => {
    assert.equal(isExternalLambdaReadyBuild({
      status: 'BUILT',
      serve_url: 'https://cdn.example.com/template/index.html',
      composition_id: 'external-main',
      build_log: 'Cloud build completed and validated successfully. remotionVersion=4.0.484',
    }), true);

    assert.equal(isExternalLambdaReadyBuild({
      status: 'BUILT',
      serve_url: 'https://cdn.example.com/template/index.html',
      composition_id: 'external-main',
      build_log: 'Cloud build completed successfully.',
    }), false);

    assert.equal(isExternalLambdaReadyBuild({
      status: 'BUILT',
      serve_url: 'https://cdn.example.com/template/index.html',
    }), false);
  });

  it('explains why a built external bundle is not Lambda-ready', () => {
    assert.deepEqual(getExternalLambdaReadiness({
      status: 'BUILT',
      serve_url: 'https://cdn.example.com/template/index.html',
      composition_id: 'external-main',
      build_log: 'Cloud build completed successfully.',
    }), {
      ready: false,
      reason: 'BUILD_NOT_VALIDATED',
    });
  });

  it('rejects validated external builds compiled with a different Remotion version', () => {
    assert.deepEqual(getExternalLambdaReadiness({
      status: 'BUILT',
      serve_url: 'https://cdn.example.com/template/index.html',
      composition_id: 'external-main',
      build_log: 'Cloud build completed and validated successfully. remotionVersion=4.0.474',
    }), {
      ready: false,
      reason: 'BUILD_REMOTION_VERSION_MISMATCH',
    });
  });
});

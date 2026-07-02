import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildStableHash,
  getRemotionRenderConfig,
  getRemotionRenderReadiness,
} from '../remotion-render.config';

function withEnv(updates: Record<string, string | undefined>, fn: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(updates)) {
    previous.set(key, process.env[key]);
    if (updates[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = updates[key];
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('getRemotionRenderConfig', () => {
  it('defaults to the local provider without requiring Lambda secrets', () => {
    withEnv({
      RENDER_PROVIDER: undefined,
      REMOTION_LAMBDA_REGION: undefined,
      REMOTION_LAMBDA_FUNCTION_NAME: undefined,
      REMOTION_LAMBDA_SERVE_URL: undefined,
      REMOTION_LAMBDA_BUCKET: undefined,
    }, () => {
      const config = getRemotionRenderConfig();
      assert.equal(config.provider, 'local');
      assert.equal(config.lambda.concurrency, 1);
      assert.equal(config.lambda.framesPerLambda, null);
      assert.equal(config.lambda.concurrencyPerLambda, 1);
    });
  });

  it('fails fast when Lambda is enabled without required config', () => {
    withEnv({
      RENDER_PROVIDER: 'lambda',
      REMOTION_LAMBDA_REGION: undefined,
      REMOTION_LAMBDA_FUNCTION_NAME: undefined,
      REMOTION_LAMBDA_SERVE_URL: undefined,
      REMOTION_LAMBDA_BUCKET: undefined,
    }, () => {
      assert.throws(() => getRemotionRenderConfig(), /REMOTION_LAMBDA_REGION/);
    });
  });

  it('hashes equivalent objects deterministically', () => {
    assert.equal(
      buildStableHash({ b: 2, a: { d: 4, c: 3 } }),
      buildStableHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it('reports Lambda readiness using only REST polling config', () => {
    withEnv({
      RENDER_PROVIDER: 'lambda',
      REMOTION_LAMBDA_REGION: 'us-east-1',
      REMOTION_LAMBDA_FUNCTION_NAME: 'remotion-render',
      REMOTION_LAMBDA_SERVE_URL: 'https://example.com/sites/courseforge',
      REMOTION_LAMBDA_BUCKET: 'courseforge-renders',
    }, () => {
      const readiness = getRemotionRenderReadiness();
      const checkNames = readiness.checks.map((check) => check.name);

      assert.equal(readiness.provider, 'lambda');
      assert.equal(checkNames.includes('REMOTION_LAMBDA_BUCKET'), true);
    });
  });

  it('allows Lambda concurrency tuning through environment variables', () => {
    withEnv({
      RENDER_PROVIDER: 'lambda',
      REMOTION_LAMBDA_REGION: 'us-east-1',
      REMOTION_LAMBDA_FUNCTION_NAME: 'remotion-render',
      REMOTION_LAMBDA_SERVE_URL: 'https://example.com/sites/courseforge',
      REMOTION_LAMBDA_BUCKET: 'courseforge-renders',
      REMOTION_LAMBDA_CONCURRENCY: '2',
      REMOTION_LAMBDA_FRAMES_PER_LAMBDA: '240',
      REMOTION_LAMBDA_CONCURRENCY_PER_LAMBDA: '1',
    }, () => {
      const config = getRemotionRenderConfig();

      assert.equal(config.lambda.concurrency, 2);
      assert.equal(config.lambda.framesPerLambda, 240);
      assert.equal(config.lambda.concurrencyPerLambda, 1);
    });
  });

  it('rejects invalid Lambda concurrency tuning values', () => {
    withEnv({
      RENDER_PROVIDER: 'lambda',
      REMOTION_LAMBDA_REGION: 'us-east-1',
      REMOTION_LAMBDA_FUNCTION_NAME: 'remotion-render',
      REMOTION_LAMBDA_SERVE_URL: 'https://example.com/sites/courseforge',
      REMOTION_LAMBDA_BUCKET: 'courseforge-renders',
      REMOTION_LAMBDA_CONCURRENCY: '0',
    }, () => {
      assert.throws(() => getRemotionRenderConfig(), /REMOTION_LAMBDA_CONCURRENCY/);
    });
  });
});

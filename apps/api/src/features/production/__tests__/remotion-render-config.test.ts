import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_LAMBDA_RENDER_TIMEOUT_MS,
  buildStableHash,
  getRemotionRenderConfig,
  getRemotionRenderReadiness,
  resolveExternalPreviewRenderTimeoutMs,
  resolveLocalRenderTimeoutMs,
} from '../remotion-render.config';
import { ensureAwsCredentialsEnv } from '../aws-credentials-env';

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
      assert.equal(config.lambda.concurrency, null);
      assert.equal(config.lambda.framesPerLambda, 600);
      assert.equal(config.lambda.concurrencyPerLambda, 1);
      assert.equal(config.lambda.timeoutInMilliseconds, DEFAULT_LAMBDA_RENDER_TIMEOUT_MS);
    });
  });

  it('accepts desktop_worker without requiring Lambda config', () => {
    withEnv({
      RENDER_PROVIDER: 'desktop_worker',
      REMOTION_LAMBDA_REGION: undefined,
      REMOTION_LAMBDA_FUNCTION_NAME: undefined,
      REMOTION_LAMBDA_SERVE_URL: undefined,
      REMOTION_LAMBDA_BUCKET: undefined,
    }, () => {
      const config = getRemotionRenderConfig();
      const readiness = getRemotionRenderReadiness();

      assert.equal(config.provider, 'desktop_worker');
      assert.equal(readiness.provider, 'desktop_worker');
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
      assert.equal(readiness.tuning.lambdaTimeoutInMilliseconds, DEFAULT_LAMBDA_RENDER_TIMEOUT_MS);
    });
  });

  it('uses framesPerLambda by default for Lambda render chunking', () => {
    withEnv({
      RENDER_PROVIDER: 'lambda',
      REMOTION_LAMBDA_REGION: 'us-east-1',
      REMOTION_LAMBDA_FUNCTION_NAME: 'remotion-render',
      REMOTION_LAMBDA_SERVE_URL: 'https://example.com/sites/courseforge',
      REMOTION_LAMBDA_BUCKET: 'courseforge-renders',
      REMOTION_LAMBDA_CONCURRENCY: undefined,
      REMOTION_LAMBDA_FRAMES_PER_LAMBDA: undefined,
      REMOTION_LAMBDA_CONCURRENCY_PER_LAMBDA: '1',
    }, () => {
      const config = getRemotionRenderConfig();

      assert.equal(config.lambda.concurrency, null);
      assert.equal(config.lambda.framesPerLambda, 600);
      assert.equal(config.lambda.concurrencyPerLambda, 1);
    });
  });

  it('allows Lambda framesPerLambda tuning through environment variables', () => {
    withEnv({
      RENDER_PROVIDER: 'lambda',
      REMOTION_LAMBDA_REGION: 'us-east-1',
      REMOTION_LAMBDA_FUNCTION_NAME: 'remotion-render',
      REMOTION_LAMBDA_SERVE_URL: 'https://example.com/sites/courseforge',
      REMOTION_LAMBDA_BUCKET: 'courseforge-renders',
      REMOTION_LAMBDA_CONCURRENCY: undefined,
      REMOTION_LAMBDA_FRAMES_PER_LAMBDA: '90',
      REMOTION_LAMBDA_CONCURRENCY_PER_LAMBDA: '1',
    }, () => {
      const config = getRemotionRenderConfig();

      assert.equal(config.lambda.concurrency, null);
      assert.equal(config.lambda.framesPerLambda, 90);
      assert.equal(config.lambda.concurrencyPerLambda, 1);
      assert.equal(config.lambda.timeoutInMilliseconds, DEFAULT_LAMBDA_RENDER_TIMEOUT_MS);
    });
  });

  it('resolves local and preview render timeouts from the right environment variables', () => {
    withEnv({
      REMOTION_RENDER_TIMEOUT_MS: undefined,
      EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS: '1800000',
      EXTERNAL_TEMPLATE_PREVIEW_RENDER_TIMEOUT_MS: '240000',
    }, () => {
      assert.equal(resolveLocalRenderTimeoutMs(), 1800000);
      assert.equal(resolveExternalPreviewRenderTimeoutMs(), 240000);
    });
  });

  it('flags production local renders without Cloud Run timeout parity', () => {
    withEnv({
      NODE_ENV: 'production',
      RENDER_PROVIDER: 'local',
      NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example.com',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      API_PUBLIC_URL: 'https://api.example.com',
      EXPRESS_PUBLIC_URL: undefined,
      REMOTION_RENDER_TIMEOUT_MS: undefined,
      EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS: undefined,
    }, () => {
      const readiness = getRemotionRenderReadiness();
      const renderTimeoutCheck = readiness.checks.find((check) => check.name === 'REMOTION_RENDER_TIMEOUT_MS');
      const externalTimeoutCheck = readiness.checks.find((check) => check.name === 'EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS');

      assert.equal(readiness.ok, false);
      assert.equal(renderTimeoutCheck?.ok, false);
      assert.equal(externalTimeoutCheck?.ok, false);
    });
  });

  it('allows Lambda concurrency tuning only when framesPerLambda is absent', () => {
    withEnv({
      RENDER_PROVIDER: 'lambda',
      REMOTION_LAMBDA_REGION: 'us-east-1',
      REMOTION_LAMBDA_FUNCTION_NAME: 'remotion-render',
      REMOTION_LAMBDA_SERVE_URL: 'https://example.com/sites/courseforge',
      REMOTION_LAMBDA_BUCKET: 'courseforge-renders',
      REMOTION_LAMBDA_CONCURRENCY: '2',
      REMOTION_LAMBDA_FRAMES_PER_LAMBDA: undefined,
      REMOTION_LAMBDA_CONCURRENCY_PER_LAMBDA: '1',
    }, () => {
      const config = getRemotionRenderConfig();

      assert.equal(config.lambda.concurrency, 2);
      assert.equal(config.lambda.framesPerLambda, null);
      assert.equal(config.lambda.concurrencyPerLambda, 1);
    });
  });

  it('rejects mixed Lambda chunking strategies', () => {
    withEnv({
      RENDER_PROVIDER: 'lambda',
      REMOTION_LAMBDA_REGION: 'us-east-1',
      REMOTION_LAMBDA_FUNCTION_NAME: 'remotion-render',
      REMOTION_LAMBDA_SERVE_URL: 'https://example.com/sites/courseforge',
      REMOTION_LAMBDA_BUCKET: 'courseforge-renders',
      REMOTION_LAMBDA_CONCURRENCY: '2',
      REMOTION_LAMBDA_FRAMES_PER_LAMBDA: '120',
    }, () => {
      assert.throws(
        () => getRemotionRenderConfig(),
        /REMOTION_LAMBDA_CONCURRENCY.*REMOTION_LAMBDA_FRAMES_PER_LAMBDA/,
      );
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

  it('allows a bounded Lambda render timeout override', () => {
    withEnv({
      RENDER_PROVIDER: 'lambda',
      REMOTION_LAMBDA_REGION: 'us-east-1',
      REMOTION_LAMBDA_FUNCTION_NAME: 'remotion-render',
      REMOTION_LAMBDA_SERVE_URL: 'https://example.com/sites/courseforge',
      REMOTION_LAMBDA_BUCKET: 'courseforge-renders',
      REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS: '840000',
    }, () => {
      const config = getRemotionRenderConfig();

      assert.equal(config.lambda.timeoutInMilliseconds, 840000);
    });
  });

  it('flags undersized production Lambda timeout overrides in readiness', () => {
    withEnv({
      NODE_ENV: 'production',
      RENDER_PROVIDER: 'lambda',
      NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example.com',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      API_PUBLIC_URL: 'https://api.example.com',
      REMOTION_LAMBDA_REGION: 'us-east-1',
      REMOTION_LAMBDA_FUNCTION_NAME: 'remotion-render',
      REMOTION_LAMBDA_SERVE_URL: 'https://example.com/sites/courseforge',
      REMOTION_LAMBDA_BUCKET: 'courseforge-renders',
      REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS: '600000',
    }, () => {
      const readiness = getRemotionRenderReadiness();
      const timeoutCheck = readiness.checks.find(
        (check) => check.name === 'REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS',
      );

      assert.equal(timeoutCheck?.ok, false);
    });
  });

  it('rejects Lambda render timeouts that exceed the function safety window', () => {
    withEnv({
      RENDER_PROVIDER: 'lambda',
      REMOTION_LAMBDA_REGION: 'us-east-1',
      REMOTION_LAMBDA_FUNCTION_NAME: 'remotion-render',
      REMOTION_LAMBDA_SERVE_URL: 'https://example.com/sites/courseforge',
      REMOTION_LAMBDA_BUCKET: 'courseforge-renders',
      REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS: '900001',
    }, () => {
      assert.throws(() => getRemotionRenderConfig(), /REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS/);
    });
  });

  it('maps Netlify-safe AWS credential aliases to the AWS SDK environment names', () => {
    withEnv({
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
      AWS_SESSION_TOKEN: undefined,
      SOFLIA_AWS_ACCESS_KEY_ID: 'alias-access-key',
      SOFLIA_AWS_SECRET_ACCESS_KEY: 'alias-secret-key',
      SOFLIA_AWS_SESSION_TOKEN: 'alias-session-token',
    }, () => {
      ensureAwsCredentialsEnv();

      assert.equal(process.env.AWS_ACCESS_KEY_ID, 'alias-access-key');
      assert.equal(process.env.AWS_SECRET_ACCESS_KEY, 'alias-secret-key');
      assert.equal(process.env.AWS_SESSION_TOKEN, 'alias-session-token');
    });
  });
});

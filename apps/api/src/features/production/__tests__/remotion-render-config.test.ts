import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
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
  it('defaults to the local legacy provider', () => {
    withEnv({ RENDER_PROVIDER: undefined }, () => {
      const config = getRemotionRenderConfig();
      assert.equal(config.provider, 'local');
    });
  });

  it('accepts desktop_worker without external render provider config', () => {
    withEnv({ RENDER_PROVIDER: 'desktop_worker' }, () => {
      const config = getRemotionRenderConfig();
      const readiness = getRemotionRenderReadiness();

      assert.equal(config.provider, 'desktop_worker');
      assert.equal(readiness.provider, 'desktop_worker');
    });
  });

  it('treats unsupported provider values as local legacy renders', () => {
    withEnv({ RENDER_PROVIDER: 'unsupported_provider' }, () => {
      const config = getRemotionRenderConfig();
      const readiness = getRemotionRenderReadiness();

      assert.equal(config.provider, 'local');
      assert.equal(readiness.provider, 'local');
    });
  });

  it('hashes equivalent objects deterministically', () => {
    assert.equal(
      buildStableHash({ b: 2, a: { d: 4, c: 3 } }),
      buildStableHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
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

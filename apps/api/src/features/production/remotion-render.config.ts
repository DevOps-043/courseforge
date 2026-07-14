import crypto from 'crypto';

export type RemotionRenderProviderSetting = 'local' | 'lambda' | 'desktop_worker';

export const DEFAULT_LOCAL_RENDER_TIMEOUT_MS = 180_000;
export const DEFAULT_EXTERNAL_TEMPLATE_PREVIEW_RENDER_TIMEOUT_MS = 90_000;
export const DEFAULT_LAMBDA_FRAMES_PER_LAMBDA = 600;
export const DEFAULT_LAMBDA_CONCURRENCY_PER_LAMBDA = 1;
export const DEFAULT_LAMBDA_RENDER_TIMEOUT_MS = 840_000;
export const MAX_LAMBDA_RENDER_TIMEOUT_MS = 870_000;
export const RECOMMENDED_CLOUD_RUN_RENDER_TIMEOUT_MS = 1_800_000;

export interface RemotionLambdaConfig {
  region: string;
  functionName: string;
  serveUrl: string;
  siteName: string | null;
  bucketName: string;
  outputPrivacy: 'public' | 'private';
  concurrency: number | null;
  framesPerLambda: number | null;
  concurrencyPerLambda: number;
  timeoutInMilliseconds: number;
}

export interface RemotionRenderConfig {
  provider: RemotionRenderProviderSetting;
  apiPublicUrl: string | null;
  lambda: RemotionLambdaConfig;
}

export interface RemotionRenderTuningSnapshot {
  localRenderTimeoutMs: number;
  externalTemplateRenderTimeoutMs: number;
  externalPreviewRenderTimeoutMs: number;
  lambdaTimeoutInMilliseconds: number;
  lambdaFramesPerLambda: number | null;
  lambdaConcurrency: number | null;
  lambdaConcurrencyPerLambda: number;
}

export interface RemotionRenderReadinessCheck {
  name: string;
  ok: boolean;
  message: string;
}

export interface RemotionRenderReadiness {
  ok: boolean;
  provider: RemotionRenderProviderSetting;
  checks: RemotionRenderReadinessCheck[];
  tuning: RemotionRenderTuningSnapshot;
}

function normalizeProvider(value: string | undefined): RemotionRenderProviderSetting {
  if (value?.toLowerCase() === 'desktop_worker') return 'desktop_worker';
  return value?.toLowerCase() === 'lambda' ? 'lambda' : 'local';
}

function optionalUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('Only HTTPS public URLs are allowed outside local development.');
    }
    return value.replace(/\/+$/, '');
  } catch {
    throw new Error(`Invalid public URL configuration: ${value}`);
  }
}

function requiredForLambda(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required when RENDER_PROVIDER=lambda.`);
  }
  return value.trim();
}

function optionalPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function optionalPositiveIntegerFromEnv(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name];
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalPositiveIntegerOrNull(name: string): number | null {
  const raw = process.env[name];
  if (!raw?.trim()) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function optionalBoundedPositiveInteger(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be a positive integer between 1 and ${max}.`);
  }
  return parsed;
}

export function getRemotionRenderConfig(): RemotionRenderConfig {
  const provider = normalizeProvider(process.env.RENDER_PROVIDER);
  const apiPublicUrl = optionalUrl(process.env.API_PUBLIC_URL || process.env.EXPRESS_PUBLIC_URL);
  const lambdaConcurrency = optionalPositiveIntegerOrNull('REMOTION_LAMBDA_CONCURRENCY');
  const lambdaFramesPerLambda = optionalPositiveIntegerOrNull('REMOTION_LAMBDA_FRAMES_PER_LAMBDA');

  if (lambdaConcurrency && lambdaFramesPerLambda) {
    throw new Error(
      'Configure only one of REMOTION_LAMBDA_CONCURRENCY or REMOTION_LAMBDA_FRAMES_PER_LAMBDA.',
    );
  }

  const lambda: RemotionLambdaConfig = {
    region: provider === 'lambda' ? requiredForLambda('REMOTION_LAMBDA_REGION') : process.env.REMOTION_LAMBDA_REGION || '',
    functionName: provider === 'lambda' ? requiredForLambda('REMOTION_LAMBDA_FUNCTION_NAME') : process.env.REMOTION_LAMBDA_FUNCTION_NAME || '',
    serveUrl: provider === 'lambda' ? requiredForLambda('REMOTION_LAMBDA_SERVE_URL') : process.env.REMOTION_LAMBDA_SERVE_URL || '',
    siteName: process.env.REMOTION_LAMBDA_SITE_NAME || null,
    bucketName: provider === 'lambda' ? requiredForLambda('REMOTION_LAMBDA_BUCKET') : process.env.REMOTION_LAMBDA_BUCKET || '',
    outputPrivacy: process.env.REMOTION_LAMBDA_OUTPUT_PRIVACY === 'public' ? 'public' : 'private',
    concurrency: lambdaConcurrency,
    framesPerLambda: lambdaFramesPerLambda || (lambdaConcurrency ? null : DEFAULT_LAMBDA_FRAMES_PER_LAMBDA),
    concurrencyPerLambda: optionalPositiveInteger(
      'REMOTION_LAMBDA_CONCURRENCY_PER_LAMBDA',
      DEFAULT_LAMBDA_CONCURRENCY_PER_LAMBDA,
    ),
    timeoutInMilliseconds: optionalBoundedPositiveInteger(
      'REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS',
      DEFAULT_LAMBDA_RENDER_TIMEOUT_MS,
      MAX_LAMBDA_RENDER_TIMEOUT_MS,
    ),
  };

  return { provider, apiPublicUrl, lambda };
}

export function getRemotionRenderReadiness(): RemotionRenderReadiness {
  const provider = normalizeProvider(process.env.RENDER_PROVIDER);
  const checks: RemotionRenderReadinessCheck[] = [];
  const tuning = getRemotionRenderTuningSnapshot();

  checks.push(requiredEnvCheck('NEXT_PUBLIC_SUPABASE_URL'));
  checks.push(requiredEnvCheck('SUPABASE_SERVICE_ROLE_KEY'));

  if (provider === 'lambda') {
    checks.push(requiredEnvCheck('REMOTION_LAMBDA_REGION'));
    checks.push(requiredEnvCheck('REMOTION_LAMBDA_FUNCTION_NAME'));
    checks.push(requiredEnvCheck('REMOTION_LAMBDA_SERVE_URL'));
    checks.push(requiredEnvCheck('REMOTION_LAMBDA_BUCKET'));
    checks.push(lambdaPackageCheck());
    checks.push(httpsUrlCheck('REMOTION_LAMBDA_SERVE_URL', process.env.REMOTION_LAMBDA_SERVE_URL));
    checks.push(lambdaTimeoutCheck());
  }

  if (provider === 'local' && process.env.NODE_ENV === 'production') {
    checks.push(requiredIntegerAtLeastCheck(
      'REMOTION_RENDER_TIMEOUT_MS',
      RECOMMENDED_CLOUD_RUN_RENDER_TIMEOUT_MS,
    ));
    checks.push(requiredIntegerAtLeastCheck(
      'EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS',
      RECOMMENDED_CLOUD_RUN_RENDER_TIMEOUT_MS,
    ));
  }

  if (process.env.NODE_ENV === 'production') {
    checks.push(requiredAnyEnvCheck(['API_PUBLIC_URL', 'EXPRESS_PUBLIC_URL']));
  }

  return {
    ok: checks.every((check) => check.ok),
    provider,
    checks,
    tuning,
  };
}

export function buildStableHash(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function resolveLocalRenderTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return optionalPositiveIntegerFromEnv(
    'REMOTION_RENDER_TIMEOUT_MS',
    optionalPositiveIntegerFromEnv(
      'EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS',
      DEFAULT_LOCAL_RENDER_TIMEOUT_MS,
      env,
    ),
    env,
  );
}

export function resolveExternalPreviewRenderTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return optionalPositiveIntegerFromEnv(
    'EXTERNAL_TEMPLATE_PREVIEW_RENDER_TIMEOUT_MS',
    optionalPositiveIntegerFromEnv(
      'EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS',
      DEFAULT_EXTERNAL_TEMPLATE_PREVIEW_RENDER_TIMEOUT_MS,
      env,
    ),
    env,
  );
}

export function getRemotionRenderTuningSnapshot(
  env: NodeJS.ProcessEnv = process.env,
): RemotionRenderTuningSnapshot {
  const lambdaConcurrency = optionalPositiveIntegerOrNullFromEnv('REMOTION_LAMBDA_CONCURRENCY', env);
  const lambdaFramesPerLambda = optionalPositiveIntegerOrNullFromEnv('REMOTION_LAMBDA_FRAMES_PER_LAMBDA', env);

  return {
    localRenderTimeoutMs: resolveLocalRenderTimeoutMs(env),
    externalTemplateRenderTimeoutMs: optionalPositiveIntegerFromEnv(
      'EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS',
      DEFAULT_LOCAL_RENDER_TIMEOUT_MS,
      env,
    ),
    externalPreviewRenderTimeoutMs: resolveExternalPreviewRenderTimeoutMs(env),
    lambdaTimeoutInMilliseconds: optionalBoundedPositiveIntegerFromEnv(
      'REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS',
      DEFAULT_LAMBDA_RENDER_TIMEOUT_MS,
      MAX_LAMBDA_RENDER_TIMEOUT_MS,
      env,
    ),
    lambdaFramesPerLambda: lambdaFramesPerLambda || (lambdaConcurrency ? null : DEFAULT_LAMBDA_FRAMES_PER_LAMBDA),
    lambdaConcurrency,
    lambdaConcurrencyPerLambda: optionalPositiveIntegerFromEnv(
      'REMOTION_LAMBDA_CONCURRENCY_PER_LAMBDA',
      DEFAULT_LAMBDA_CONCURRENCY_PER_LAMBDA,
      env,
    ),
  };
}

function requiredEnvCheck(name: string): RemotionRenderReadinessCheck {
  const ok = Boolean(process.env[name]?.trim());
  return {
    name,
    ok,
    message: ok ? `${name} is configured.` : `${name} is missing.`,
  };
}

function requiredAnyEnvCheck(names: string[]): RemotionRenderReadinessCheck {
  const configuredName = names.find((name) => Boolean(process.env[name]?.trim()));
  return {
    name: names.join('|'),
    ok: Boolean(configuredName),
    message: configuredName
      ? `${configuredName} is configured.`
      : `One of ${names.join(', ')} is required in production.`,
  };
}

function requiredIntegerAtLeastCheck(name: string, minimum: number): RemotionRenderReadinessCheck {
  const raw = process.env[name];
  const parsed = raw?.trim() ? Number(raw) : NaN;
  const ok = Number.isInteger(parsed) && parsed >= minimum;

  return {
    name,
    ok,
    message: ok
      ? `${name} is configured for long-running Cloud Run renders.`
      : `${name} must be an integer >= ${minimum} for production local renders.`,
  };
}

function lambdaTimeoutCheck(): RemotionRenderReadinessCheck {
  const raw = process.env.REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS;
  if (!raw?.trim()) {
    return {
      name: 'REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS',
      ok: true,
      message: `Using default Lambda timeout ${DEFAULT_LAMBDA_RENDER_TIMEOUT_MS}ms.`,
    };
  }

  const parsed = Number(raw);
  const minimum = process.env.NODE_ENV === 'production' ? DEFAULT_LAMBDA_RENDER_TIMEOUT_MS : 1;
  const ok = Number.isInteger(parsed) && parsed >= minimum && parsed <= MAX_LAMBDA_RENDER_TIMEOUT_MS;
  return {
    name: 'REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS',
    ok,
    message: ok
      ? 'REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS is within the Lambda safety window.'
      : `REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS must be between ${minimum} and ${MAX_LAMBDA_RENDER_TIMEOUT_MS}.`,
  };
}

function lambdaPackageCheck(): RemotionRenderReadinessCheck {
  try {
    require.resolve('@remotion/lambda/client');
    return {
      name: '@remotion/lambda',
      ok: true,
      message: '@remotion/lambda is installed.',
    };
  } catch {
    return {
      name: '@remotion/lambda',
      ok: false,
      message: '@remotion/lambda is not installed in the current runtime.',
    };
  }
}

function httpsUrlCheck(name: string, value: string | undefined): RemotionRenderReadinessCheck {
  if (!value?.trim()) {
    return { name, ok: false, message: `${name} is missing.` };
  }

  try {
    const url = new URL(value);
    const ok = url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return {
      name,
      ok,
      message: ok ? `${name} is a valid URL.` : `${name} must use HTTPS outside local development.`,
    };
  } catch {
    return {
      name,
      ok: false,
      message: `${name} is not a valid URL.`,
    };
  }
}

function optionalPositiveIntegerOrNullFromEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env[name];
  if (!raw?.trim()) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalBoundedPositiveIntegerFromEnv(
  name: string,
  fallback: number,
  max: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name];
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

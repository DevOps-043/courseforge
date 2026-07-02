import crypto from 'crypto';

export type RemotionRenderProviderSetting = 'local' | 'lambda';

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
}

export interface RemotionRenderConfig {
  provider: RemotionRenderProviderSetting;
  apiPublicUrl: string | null;
  lambda: RemotionLambdaConfig;
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
}

function normalizeProvider(value: string | undefined): RemotionRenderProviderSetting {
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

function optionalPositiveIntegerOrNull(name: string): number | null {
  const raw = process.env[name];
  if (!raw?.trim()) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function getRemotionRenderConfig(): RemotionRenderConfig {
  const provider = normalizeProvider(process.env.RENDER_PROVIDER);
  const apiPublicUrl = optionalUrl(process.env.API_PUBLIC_URL || process.env.EXPRESS_PUBLIC_URL);

  const lambda: RemotionLambdaConfig = {
    region: provider === 'lambda' ? requiredForLambda('REMOTION_LAMBDA_REGION') : process.env.REMOTION_LAMBDA_REGION || '',
    functionName: provider === 'lambda' ? requiredForLambda('REMOTION_LAMBDA_FUNCTION_NAME') : process.env.REMOTION_LAMBDA_FUNCTION_NAME || '',
    serveUrl: provider === 'lambda' ? requiredForLambda('REMOTION_LAMBDA_SERVE_URL') : process.env.REMOTION_LAMBDA_SERVE_URL || '',
    siteName: process.env.REMOTION_LAMBDA_SITE_NAME || null,
    bucketName: provider === 'lambda' ? requiredForLambda('REMOTION_LAMBDA_BUCKET') : process.env.REMOTION_LAMBDA_BUCKET || '',
    outputPrivacy: process.env.REMOTION_LAMBDA_OUTPUT_PRIVACY === 'public' ? 'public' : 'private',
    concurrency: optionalPositiveIntegerOrNull('REMOTION_LAMBDA_CONCURRENCY') || 1,
    framesPerLambda: optionalPositiveIntegerOrNull('REMOTION_LAMBDA_FRAMES_PER_LAMBDA'),
    concurrencyPerLambda: optionalPositiveInteger('REMOTION_LAMBDA_CONCURRENCY_PER_LAMBDA', 1),
  };

  return { provider, apiPublicUrl, lambda };
}

export function getRemotionRenderReadiness(): RemotionRenderReadiness {
  const provider = normalizeProvider(process.env.RENDER_PROVIDER);
  const checks: RemotionRenderReadinessCheck[] = [];

  checks.push(requiredEnvCheck('NEXT_PUBLIC_SUPABASE_URL'));
  checks.push(requiredEnvCheck('SUPABASE_SERVICE_ROLE_KEY'));

  if (provider === 'lambda') {
    checks.push(requiredEnvCheck('REMOTION_LAMBDA_REGION'));
    checks.push(requiredEnvCheck('REMOTION_LAMBDA_FUNCTION_NAME'));
    checks.push(requiredEnvCheck('REMOTION_LAMBDA_SERVE_URL'));
    checks.push(requiredEnvCheck('REMOTION_LAMBDA_BUCKET'));
    checks.push(lambdaPackageCheck());
    checks.push(httpsUrlCheck('REMOTION_LAMBDA_SERVE_URL', process.env.REMOTION_LAMBDA_SERVE_URL));
  }

  if (process.env.NODE_ENV === 'production') {
    checks.push(requiredAnyEnvCheck(['API_PUBLIC_URL', 'EXPRESS_PUBLIC_URL']));
  }

  return {
    ok: checks.every((check) => check.ok),
    provider,
    checks,
  };
}

export function buildStableHash(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

import crypto from 'crypto';

export type RemotionRenderProviderSetting = 'local' | 'desktop_worker';

export const DEFAULT_LOCAL_RENDER_TIMEOUT_MS = 180_000;
export const DEFAULT_EXTERNAL_TEMPLATE_PREVIEW_RENDER_TIMEOUT_MS = 90_000;
export const RECOMMENDED_CLOUD_RUN_RENDER_TIMEOUT_MS = 1_800_000;

export interface RemotionRenderConfig {
  provider: RemotionRenderProviderSetting;
  apiPublicUrl: string | null;
}

export interface RemotionRenderTuningSnapshot {
  localRenderTimeoutMs: number;
  externalTemplateRenderTimeoutMs: number;
  externalPreviewRenderTimeoutMs: number;
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
  return 'local';
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

export function getRemotionRenderConfig(): RemotionRenderConfig {
  const provider = normalizeProvider(process.env.RENDER_PROVIDER);
  const apiPublicUrl = optionalUrl(process.env.API_PUBLIC_URL || process.env.EXPRESS_PUBLIC_URL);

  return { provider, apiPublicUrl };
}

export function getRemotionRenderReadiness(): RemotionRenderReadiness {
  const provider = normalizeProvider(process.env.RENDER_PROVIDER);
  const checks: RemotionRenderReadinessCheck[] = [];
  const tuning = getRemotionRenderTuningSnapshot();

  checks.push(requiredEnvCheck('NEXT_PUBLIC_SUPABASE_URL'));
  checks.push(requiredEnvCheck('SUPABASE_SERVICE_ROLE_KEY'));

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
  return {
    localRenderTimeoutMs: resolveLocalRenderTimeoutMs(env),
    externalTemplateRenderTimeoutMs: optionalPositiveIntegerFromEnv(
      'EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS',
      DEFAULT_LOCAL_RENDER_TIMEOUT_MS,
      env,
    ),
    externalPreviewRenderTimeoutMs: resolveExternalPreviewRenderTimeoutMs(env),
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

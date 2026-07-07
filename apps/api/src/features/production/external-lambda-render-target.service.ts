export interface ExternalLambdaRenderTargetInput {
  jobSnapshot?: Record<string, unknown> | null;
  version?: Record<string, unknown> | null;
  build?: Record<string, unknown> | null;
}

const COURSEFORGE_REMOTION_VERSION = '4.0.484';

export interface ExternalLambdaRenderTarget {
  templateVersionId: string;
  buildId: string;
  serveUrl: string;
  compositionId: string;
  exportMode: 'component' | 'root';
  buildHash: string | null;
  bundleHash: string | null;
  cloudProvider: string | null;
}

export function resolveExternalLambdaRenderTarget(
  input: ExternalLambdaRenderTargetInput,
): ExternalLambdaRenderTarget {
  const snapshot = input.jobSnapshot ?? {};
  const version = input.version ?? {};
  const build = input.build ?? {};

  const templateVersionId = readNonEmptyString(snapshot.templateVersionId) || readNonEmptyString(version.id);
  const buildId = readNonEmptyString(snapshot.buildId) || readNonEmptyString(build.id);
  if (!templateVersionId || !buildId) {
    throw new Error('EXTERNAL_RENDER_TARGET_INCOMPLETE: falta templateVersionId o buildId.');
  }

  if (build.status !== 'BUILT') {
    throw new Error('EXTERNAL_BUILD_NOT_READY: el build cloud no esta en estado BUILT.');
  }

  const serveUrl = readNonEmptyString(build.serve_url) || readNonEmptyString(snapshot.externalServeUrl);
  if (!serveUrl || !isHttpsUrl(serveUrl)) {
    throw new Error('EXTERNAL_RENDER_TARGET_INCOMPLETE: el build cloud no tiene serve_url HTTPS.');
  }

  const rawCompositionCandidates = [
    readNonEmptyString(build.composition_id),
    readNonEmptyString(version.composition_id),
    readNonEmptyString(snapshot.compositionId),
  ];
  const compositionId = rawCompositionCandidates.find(isValidCompositionId);
  if (!compositionId) {
    throw new Error('EXTERNAL_COMPOSITION_ID_MISSING: el bundle cloud no declaro composition_id.');
  }

  return {
    templateVersionId,
    buildId,
    serveUrl,
    compositionId,
    exportMode: build.export_mode === 'root' || version.export_mode === 'root' || snapshot.exportMode === 'root'
      ? 'root'
      : 'component',
    buildHash: readNonEmptyString(build.build_hash) || readNonEmptyString(version.build_hash) || null,
    bundleHash: readNonEmptyString(build.bundle_hash) || readNonEmptyString(version.bundle_hash) || readNonEmptyString(snapshot.bundleHash) || null,
    cloudProvider: readNonEmptyString(build.cloud_provider) || readNonEmptyString(snapshot.cloudProvider) || null,
  };
}

export function isExternalLambdaReadyBuild(build: unknown): build is Record<string, unknown> {
  return getExternalLambdaReadiness(build).ready;
}

export function getExternalLambdaReadiness(build: unknown): {
  ready: boolean;
  reason: string | null;
} {
  if (!build || typeof build !== 'object' || Array.isArray(build)) {
    return { ready: false, reason: 'BUILD_MISSING' };
  }

  const record = build as Record<string, unknown>;
  if (record.status !== 'BUILT') {
    return { ready: false, reason: 'BUILD_NOT_BUILT' };
  }

  if (!isHttpsUrl(record.serve_url)) {
    return { ready: false, reason: 'SERVE_URL_NOT_HTTPS' };
  }

  const compositionId = readNonEmptyString(record.composition_id);
  if (!compositionId) {
    return { ready: false, reason: 'COMPOSITION_ID_MISSING' };
  }

  if (!isValidCompositionId(compositionId)) {
    return { ready: false, reason: 'COMPOSITION_ID_INVALID' };
  }

  if (!isValidatedBuildLog(record.build_log)) {
    return { ready: false, reason: 'BUILD_NOT_VALIDATED' };
  }

  if (!hasExpectedRemotionVersion(record.build_log)) {
    return { ready: false, reason: 'BUILD_REMOTION_VERSION_MISMATCH' };
  }

  return { ready: true, reason: null };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

function isValidCompositionId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (/^https?:\/\//i.test(normalized)) return false;
  if (normalized.includes('/') || normalized.includes('\\')) return false;
  if (/\.html?$/i.test(normalized)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized);
}

function isValidatedBuildLog(value: unknown): boolean {
  return typeof value === 'string' && value.toLowerCase().includes('validated');
}

function hasExpectedRemotionVersion(value: unknown): boolean {
  return typeof value === 'string' &&
    value.toLowerCase().includes(`remotionversion=${COURSEFORGE_REMOTION_VERSION.toLowerCase()}`);
}

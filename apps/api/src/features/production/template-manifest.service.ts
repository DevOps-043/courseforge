import JSZip from 'jszip';

export const MANIFEST_FILE_NAME = 'courseforge-remotion-template.json';
const MAX_MANIFEST_BYTES = 64 * 1024;

export interface TemplateBundleManifest {
  entryPoint: string;
  compositionId: string;
  compositionIds?: string[];
  exportMode: 'component' | 'root';
  defaultDurationFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
  propsSchema?: Record<string, unknown>;
  defaultProps?: Record<string, unknown>;
}

export interface ManifestReadResult {
  manifest: TemplateBundleManifest | null;
  error: string | null;
}

export async function readManifestFromZipBuffer(
  zipBuffer: Buffer,
): Promise<ManifestReadResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch {
    return { manifest: null, error: 'ZIP invalido o corrupto' };
  }

  const manifestEntry = zip.file(MANIFEST_FILE_NAME);
  if (!manifestEntry) {
    return {
      manifest: null,
      error: `Manifest '${MANIFEST_FILE_NAME}' no encontrado en el ZIP`,
    };
  }

  const rawBytes = await manifestEntry.async('nodebuffer');
  if (rawBytes.length > MAX_MANIFEST_BYTES) {
    return { manifest: null, error: 'Manifest excede 64KB' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBytes.toString('utf8'));
  } catch {
    return { manifest: null, error: 'Manifest no es JSON valido' };
  }

  const result = validateManifestShape(parsed);
  if (!result.valid) {
    return { manifest: null, error: result.error };
  }

  return { manifest: result.manifest, error: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function validateManifestShape(
  parsed: unknown,
): { valid: true; manifest: TemplateBundleManifest } | { valid: false; error: string } {
  if (!isRecord(parsed)) {
    return { valid: false, error: 'Manifest debe ser un objeto JSON' };
  }

  if (typeof parsed.entryPoint !== 'string' || !parsed.entryPoint.trim()) {
    return { valid: false, error: 'Manifest debe incluir "entryPoint" (string)' };
  }

  if (typeof parsed.compositionId !== 'string' || !parsed.compositionId.trim()) {
    return { valid: false, error: 'Manifest debe incluir "compositionId" (string)' };
  }

  const compositionIds = Array.isArray(parsed.compositionIds)
    ? parsed.compositionIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : undefined;

  return {
    valid: true,
    manifest: {
      entryPoint: parsed.entryPoint.trim(),
      compositionId: parsed.compositionId.trim(),
      compositionIds,
      exportMode: parsed.exportMode === 'root' ? 'root' : 'component',
      defaultDurationFrames: optionalPositiveInteger(parsed.defaultDurationFrames),
      fps: optionalPositiveInteger(parsed.fps),
      width: optionalPositiveInteger(parsed.width),
      height: optionalPositiveInteger(parsed.height),
      propsSchema: isRecord(parsed.propsSchema) ? parsed.propsSchema : undefined,
      defaultProps: isRecord(parsed.defaultProps) ? parsed.defaultProps : undefined,
    },
  };
}

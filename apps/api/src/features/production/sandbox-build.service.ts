import crypto from 'crypto';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getOrBuildBundle } from './sandbox-runner/bundle-cache';
import { readManifestFromZipBuffer, type TemplateBundleManifest } from './template-manifest.service';

export interface SandboxBuildInput {
  templateVersionId: string;
  bundleZipPath: string;
  bundleHash: string;
  organizationId: string;
}

export interface SandboxBuildResult {
  success: boolean;
  buildId?: string;
  serveUrl?: string;
  buildHash?: string;
  compositionId?: string;
  exportMode?: 'component' | 'root';
  error?: string;
}

interface BuildRecord {
  id: string;
}

export class SandboxBuildService {
  constructor(private readonly supabase: any) {}

  async buildFromZip(input: SandboxBuildInput): Promise<SandboxBuildResult> {
    let zipBuffer: Buffer;
    try {
      zipBuffer = await this.downloadZip(input.bundleZipPath);
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }

    const { manifest, error: manifestError } = await readManifestFromZipBuffer(zipBuffer);

    if (!manifest) {
      return { success: false, error: manifestError ?? 'Manifest invalido' };
    }

    const build = await this.createBuildRecord(input, manifest);
    if (!build) {
      return { success: false, error: 'No se pudo registrar el build' };
    }

    await this.supabase
      .from('remotion_template_versions')
      .update({ build_status: 'BUILDING' })
      .eq('id', input.templateVersionId);

    const tempZipPath = await this.writeTempZip(zipBuffer, input.bundleHash);

    try {
      const { serveUrl } = await getOrBuildBundle({
        bundleZipPath: tempZipPath,
        bundleHash: input.bundleHash,
        entryPoint: manifest.entryPoint,
        compositionId: manifest.compositionId,
        exportMode: manifest.exportMode,
        defaultDurationInFrames: manifest.defaultDurationFrames,
        defaultFps: manifest.fps,
        defaultWidth: manifest.width,
        defaultHeight: manifest.height,
      });
      const buildHash = await this.hashBuildOutput(serveUrl);
      const builtAt = new Date().toISOString();

      await this.supabase
        .from('remotion_template_builds')
        .update({
          status: 'BUILT',
          serve_url: serveUrl,
          build_hash: buildHash,
          entrypoint_path: manifest.entryPoint,
          build_log: 'Build completed by SandboxBuildService.',
          built_at: builtAt,
        })
        .eq('id', build.id);

      await this.supabase
        .from('remotion_template_versions')
        .update({
          build_status: 'BUILT',
          build_hash: buildHash,
          build_output_path: serveUrl,
          built_at: builtAt,
        })
        .eq('id', input.templateVersionId);

      return {
        success: true,
        buildId: build.id,
        serveUrl,
        buildHash,
        compositionId: manifest.compositionId,
        exportMode: manifest.exportMode,
      };
    } catch (error) {
      const errorMessage = sanitizeError(error);
      const failedAt = new Date().toISOString();

      await this.supabase
        .from('remotion_template_builds')
        .update({
          status: 'BUILD_FAILED',
          build_error: errorMessage,
          build_failed_at: failedAt,
        })
        .eq('id', build.id);

      await this.supabase
        .from('remotion_template_versions')
        .update({
          build_status: 'BUILD_FAILED',
        })
        .eq('id', input.templateVersionId);

      return { success: false, buildId: build.id, error: errorMessage };
    } finally {
      await fsp.rm(path.dirname(tempZipPath), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async createBuildRecord(
    input: SandboxBuildInput,
    manifest: TemplateBundleManifest,
  ): Promise<BuildRecord | null> {
    const compositionIds = Array.from(new Set([manifest.compositionId, ...(manifest.compositionIds ?? [])]));
    const { data, error } = await this.supabase
      .from('remotion_template_builds')
      .insert({
        template_version_id: input.templateVersionId,
        organization_id: input.organizationId,
        bundle_hash: input.bundleHash,
        status: 'BUILDING',
        composition_id: manifest.compositionId,
        composition_ids: compositionIds,
        export_mode: manifest.exportMode,
        entrypoint_path: manifest.entryPoint,
      })
      .select('id')
      .single();

    if (error || !data) {
      return null;
    }

    return data as BuildRecord;
  }

  private resolveBundleStorageLocation(storagePath: string): { bucket: string; path: string } {
    const normalized = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const separatorIndex = normalized.indexOf('/');

    if (separatorIndex === -1) {
      return { bucket: 'template-bundles', path: normalized };
    }

    return {
      bucket: normalized.slice(0, separatorIndex),
      path: normalized.slice(separatorIndex + 1),
    };
  }

  private async downloadZip(storagePath: string): Promise<Buffer> {
    const { bucket, path: objectPath } = this.resolveBundleStorageLocation(storagePath);
    const { data, error } = await this.supabase.storage.from(bucket).download(objectPath);

    if (error || !data) {
      throw new Error(`No se pudo descargar el bundle para build: ${error?.message || 'archivo no encontrado'}`);
    }

    return Buffer.from(await data.arrayBuffer());
  }

  private async writeTempZip(buffer: Buffer, bundleHash: string): Promise<string> {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'courseforge-sandbox-build-'));
    const safeHash = bundleHash.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'bundle';
    const zipPath = path.join(tempDir, `${safeHash}.zip`);
    await fsp.writeFile(zipPath, buffer);
    return zipPath;
  }

  private async hashBuildOutput(buildDir: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const files = await collectFiles(buildDir);

    for (const filePath of files) {
      const relativePath = path.relative(buildDir, filePath).replace(/\\/g, '/');
      hash.update(relativePath);
      hash.update(await fsp.readFile(filePath));
    }

    return hash.digest('hex');
  }
}

async function collectFiles(rootDir: string): Promise<string[]> {
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Build failed');
  return message
    .replace(/SUPABASE_SERVICE_ROLE_KEY=[^\s]+/gi, 'SUPABASE_SERVICE_ROLE_KEY=[redacted]')
    .replace(/OPENAI_API_KEY=[^\s]+/gi, 'OPENAI_API_KEY=[redacted]')
    .replace(/GOOGLE_GENERATIVE_AI_API_KEY=[^\s]+/gi, 'GOOGLE_GENERATIVE_AI_API_KEY=[redacted]')
    .slice(0, 2000);
}

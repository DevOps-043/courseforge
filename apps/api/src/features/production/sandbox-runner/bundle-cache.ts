import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import crypto from 'crypto';
import { bundle } from '@remotion/bundler';
import JSZip from 'jszip';

export interface CachedBundle {
  extractedDir: string;
  serveUrl: string;
}

export type BundleExportMode = 'component' | 'root';

const CACHE_ROOT = path.join(os.tmpdir(), 'courseforge-sandbox-bundles');
const SAFE_BUNDLE_HASH_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;
const ZIP_SYMLINK_FILE_TYPE = 0o120000;

function log(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.error('[SandboxBundleCache]', message, meta);
    return;
  }

  console.error('[SandboxBundleCache]', message);
}

function assertSafeBundleHash(bundleHash: string): void {
  if (!SAFE_BUNDLE_HASH_PATTERN.test(bundleHash)) {
    throw new Error('Invalid bundleHash for sandbox cache path.');
  }
}

function toSafeCacheSegment(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function resolveInsideDirectory(rootDir: string, entryName: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const normalizedEntryName = entryName.replace(/\\/g, '/');
  const resolvedEntryPath = path.resolve(resolvedRoot, normalizedEntryName);

  if (resolvedEntryPath !== resolvedRoot && !resolvedEntryPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path traversal detected in ZIP entry: ${entryName}`);
  }

  return resolvedEntryPath;
}

function assertSafeEntryPoint(extractedDir: string, entryPoint: string): string {
  if (!entryPoint || path.isAbsolute(entryPoint)) {
    throw new Error('Sandbox bundle entryPoint must be a relative path.');
  }

  return resolveInsideDirectory(extractedDir, entryPoint);
}

function isZipSymlink(entry: JSZip.JSZipObject): boolean {
  const permissions = entry.unixPermissions;
  return typeof permissions === 'number' && (permissions & ZIP_SYMLINK_FILE_TYPE) === ZIP_SYMLINK_FILE_TYPE;
}

async function extractZip(bundleZipPath: string, extractedDir: string): Promise<void> {
  const zipBuffer = await fsp.readFile(bundleZipPath);
  const zip = await JSZip.loadAsync(zipBuffer);

  await fsp.mkdir(extractedDir, { recursive: true });

  for (const entry of Object.values(zip.files)) {
    const entryPath = resolveInsideDirectory(extractedDir, entry.name);

    if (isZipSymlink(entry)) {
      throw new Error(`Symlink entries are not allowed in sandbox ZIP bundles: ${entry.name}`);
    }

    if (entry.dir) {
      await fsp.mkdir(entryPath, { recursive: true });
      continue;
    }

    await fsp.mkdir(path.dirname(entryPath), { recursive: true });
    const content = await entry.async('nodebuffer');
    await fsp.writeFile(entryPath, content);
  }
}

function getApiNodeModulesPath(): string {
  return path.resolve(__dirname, '../../../../node_modules');
}

function getWorkspaceNodeModulesPath(): string {
  return path.resolve(__dirname, '../../../../../../node_modules');
}

function toImportSpecifier(fromFilePath: string, targetFilePath: string): string {
  const relativePath = path.relative(path.dirname(fromFilePath), targetFilePath).replace(/\\/g, '/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

async function writeGeneratedRemotionEntry(params: {
  extractedDir: string;
  templateEntryPointPath: string;
  compositionId: string;
  exportMode: BundleExportMode;
  defaultDurationInFrames?: number;
  defaultFps?: number;
  defaultWidth?: number;
  defaultHeight?: number;
}): Promise<string> {
  if (params.exportMode === 'root') {
    return params.templateEntryPointPath;
  }

  const generatedDir = path.join(params.extractedDir, '.courseforge');
  const generatedEntryPath = path.join(generatedDir, 'remotion-entry.tsx');
  const templateImportSpecifier = toImportSpecifier(generatedEntryPath, params.templateEntryPointPath);
  const serializedCompositionId = JSON.stringify(params.compositionId);
  const durationInFrames = params.defaultDurationInFrames ?? 300;
  const fps = params.defaultFps ?? 30;
  const width = params.defaultWidth ?? 1920;
  const height = params.defaultHeight ?? 1080;

  await fsp.mkdir(generatedDir, { recursive: true });
  await fsp.writeFile(
    generatedEntryPath,
    [
      "import React from 'react';",
      "import { Composition, registerRoot } from 'remotion';",
      `import * as TemplateModule from '${templateImportSpecifier}';`,
      '',
      'const ExternalComposition = TemplateModule.MyComposition ?? TemplateModule.default;',
      'const calculateMetadata = TemplateModule.calculateMetadata;',
      '',
      'function CourseforgeSandboxRoot() {',
      '  if (!ExternalComposition) {',
      "    throw new Error('External template (component mode) must export MyComposition or a default component.');",
      '  }',
      '',
      '  return (',
      '    <Composition',
      `      id={${serializedCompositionId}}`,
      '      component={ExternalComposition}',
      '      calculateMetadata={calculateMetadata}',
      `      durationInFrames={${durationInFrames}}`,
      `      fps={${fps}}`,
      `      width={${width}}`,
      `      height={${height}}`,
      '    />',
      '  );',
      '}',
      '',
      'registerRoot(CourseforgeSandboxRoot);',
      '',
    ].join('\n'),
    'utf8',
  );

  return generatedEntryPath;
}

async function buildRemotionBundle(entryPointPath: string, bundleDir: string): Promise<string> {
  await fsp.mkdir(bundleDir, { recursive: true });

  return bundle({
    entryPoint: entryPointPath,
    outDir: bundleDir,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        modules: [getApiNodeModulesPath(), getWorkspaceNodeModulesPath(), 'node_modules'],
      },
    }),
  });
}

export async function getOrBuildBundle(params: {
  bundleZipPath: string;
  bundleHash: string;
  entryPoint: string;
  compositionId: string;
  exportMode?: BundleExportMode;
  defaultDurationInFrames?: number;
  defaultFps?: number;
  defaultWidth?: number;
  defaultHeight?: number;
}): Promise<CachedBundle> {
  assertSafeBundleHash(params.bundleHash);

  if (!fs.existsSync(params.bundleZipPath)) {
    throw new Error(`Sandbox bundle ZIP was not found: ${params.bundleZipPath}`);
  }

  const exportMode = params.exportMode ?? 'component';
  const cacheKey = [
    params.compositionId,
    exportMode,
    params.defaultDurationInFrames ?? 'default-duration',
    params.defaultFps ?? 'default-fps',
    params.defaultWidth ?? 'default-width',
    params.defaultHeight ?? 'default-height',
  ].join(':');
  const cacheDir = path.join(CACHE_ROOT, params.bundleHash, toSafeCacheSegment(cacheKey));
  const extractedDir = path.join(cacheDir, 'extracted');
  const bundleDir = path.join(cacheDir, 'bundle');
  const bundleIndexPath = path.join(bundleDir, 'index.html');
  const templateEntryPointPath = assertSafeEntryPoint(extractedDir, params.entryPoint);

  if (fs.existsSync(bundleIndexPath)) {
    log('Using cached Remotion bundle.', {
      bundleHash: params.bundleHash,
      compositionId: params.compositionId,
      bundleDir,
    });
    return { extractedDir, serveUrl: bundleDir };
  }

  if (fs.existsSync(bundleDir)) {
    log('Removing incomplete cached Remotion bundle.', {
      bundleHash: params.bundleHash,
      compositionId: params.compositionId,
      bundleDir,
    });
    await fsp.rm(bundleDir, { recursive: true, force: true });
  }

  if (!fs.existsSync(extractedDir)) {
    log('Extracting sandbox ZIP bundle.', {
      bundleHash: params.bundleHash,
      compositionId: params.compositionId,
      bundleZipPath: params.bundleZipPath,
      extractedDir,
    });
    await extractZip(params.bundleZipPath, extractedDir);
  } else {
    log('Using cached extracted sandbox ZIP.', {
      bundleHash: params.bundleHash,
      compositionId: params.compositionId,
      extractedDir,
    });
  }

  if (!fs.existsSync(templateEntryPointPath)) {
    throw new Error(`Sandbox bundle entryPoint was not found: ${params.entryPoint}`);
  }

  const generatedEntryPointPath = await writeGeneratedRemotionEntry({
    extractedDir,
    templateEntryPointPath,
    compositionId: params.compositionId,
    exportMode,
    defaultDurationInFrames: params.defaultDurationInFrames,
    defaultFps: params.defaultFps,
    defaultWidth: params.defaultWidth,
    defaultHeight: params.defaultHeight,
  });
  log('Building Remotion bundle for external template.', {
    bundleHash: params.bundleHash,
    compositionId: params.compositionId,
    exportMode,
    templateEntryPointPath,
    generatedEntryPointPath,
    bundleDir,
  });
  const serveUrl = await buildRemotionBundle(generatedEntryPointPath, bundleDir);
  log('Built Remotion bundle for external template.', {
    bundleHash: params.bundleHash,
    compositionId: params.compositionId,
    serveUrl,
  });
  return { extractedDir, serveUrl };
}

export const sandboxBundleCacheInternals = {
  CACHE_ROOT,
  resolveInsideDirectory,
  toSafeCacheSegment,
  writeGeneratedRemotionEntry,
};

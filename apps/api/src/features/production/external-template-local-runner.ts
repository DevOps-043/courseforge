import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';

interface SandboxPayload {
  jobId: string;
  templateVersionId: string;
  bundleHash: string;
  bundleZipPath: string;
  entryPoint: string;
  compositionId: string;
  inputProps: {
    fps?: number;
    totalDurationInFrames?: number;
    [key: string]: unknown;
  };
  assetAllowlist: string[];
}

const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
const MAX_FILE_COUNT = 1000;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 30;
const DEFAULT_DURATION_IN_FRAMES = 300;

function log(message: string, meta?: unknown) {
  if (meta === undefined) {
    console.error(`[ExternalTemplateLocalRunner] ${message}`);
    return;
  }

  console.error(`[ExternalTemplateLocalRunner] ${message}`, meta);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function assertSafeZipPath(name: string) {
  const normalized = name.endsWith('/') ? name.slice(0, -1) : name;
  const segments = normalized.split('/');
  const unsafe =
    normalized.includes('..') ||
    normalized.includes('\\') ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment.startsWith('.'));

  if (unsafe) {
    throw new Error(`Ruta no permitida dentro del ZIP: ${name}`);
  }
}

function assertPathInside(baseDir: string, targetPath: string) {
  const relative = path.relative(baseDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Ruta fuera del directorio sandbox: ${targetPath}`);
  }
}

async function extractZip(zipPath: string, extractDir: string) {
  const raw = await fsp.readFile(zipPath);
  const zip = await JSZip.loadAsync(raw);
  const files = Object.values(zip.files);

  if (files.length > MAX_FILE_COUNT) {
    throw new Error(`El ZIP contiene demasiados archivos (${files.length}).`);
  }

  let totalBytes = 0;
  await fsp.mkdir(extractDir, { recursive: true });

  for (const file of files) {
    assertSafeZipPath(file.name);
    const destination = path.join(extractDir, file.name);
    assertPathInside(extractDir, destination);

    if (file.dir) {
      await fsp.mkdir(destination, { recursive: true });
      continue;
    }

    const content = Buffer.from(await file.async('uint8array'));
    totalBytes += content.byteLength;
    if (totalBytes > MAX_UNZIPPED_BYTES) {
      throw new Error('El contenido descomprimido supera el limite de 50MB.');
    }

    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.writeFile(destination, content);
  }
}

function withoutExtension(filePath: string) {
  return filePath.replace(/\.(tsx|ts|jsx|js)$/i, '');
}

function resolveNodeModules() {
  const candidates = [
    path.resolve(process.cwd(), 'node_modules'),
    path.resolve(process.cwd(), '..', '..', 'node_modules'),
    path.resolve(__dirname, '..', '..', '..', '..', 'node_modules'),
    path.resolve(__dirname, '..', '..', '..', '..', '..', 'node_modules'),
  ];

  return candidates.filter((candidate) => fs.existsSync(candidate));
}

async function createWrapperEntry(params: {
  extractDir: string;
  entryPoint: string;
  compositionId: string;
  inputProps: SandboxPayload['inputProps'];
}) {
  assertSafeZipPath(params.entryPoint);

  const entryAbsolutePath = path.join(params.extractDir, params.entryPoint);
  assertPathInside(params.extractDir, entryAbsolutePath);

  if (!fs.existsSync(entryAbsolutePath)) {
    throw new Error(`El entryPoint del bundle no existe: ${params.entryPoint}`);
  }

  const importPath = `./${withoutExtension(params.entryPoint).replace(/\\/g, '/')}`;
  const fps = Number.isFinite(params.inputProps?.fps) ? Number(params.inputProps.fps) : DEFAULT_FPS;
  const totalDurationInFrames = Number.isFinite(params.inputProps?.totalDurationInFrames)
    ? Number(params.inputProps.totalDurationInFrames)
    : DEFAULT_DURATION_IN_FRAMES;
  const wrapperPath = path.join(params.extractDir, 'courseforge-sandbox-entry.tsx');
  const wrapper = `import React from "react";
import { Composition, registerRoot } from "remotion";
import * as TemplateModule from ${JSON.stringify(importPath)};

const Component =
  (TemplateModule as any).MyComposition ||
  (TemplateModule as any).AdvancedAvatarSubtitles ||
  (TemplateModule as any).Template ||
  (TemplateModule as any).default;

if (!Component) {
  throw new Error("El bundle debe exportar MyComposition, Template o default.");
}

// Use calculateMetadata exported by the template if present.
// This lets templates derive their duration from the actual avatar video length
// instead of relying on the static defaultDurationInFrames.
const templateCalculateMetadata =
  typeof (TemplateModule as any).calculateMetadata === 'function'
    ? (TemplateModule as any).calculateMetadata
    : undefined;

const inputProps = ${JSON.stringify(params.inputProps ?? {})};

const RemotionRoot = () => (
  <Composition
    id=${JSON.stringify(params.compositionId)}
    component={Component}
    width={${DEFAULT_WIDTH}}
    height={${DEFAULT_HEIGHT}}
    fps={${fps}}
    durationInFrames={${totalDurationInFrames}}
    defaultProps={inputProps}
    calculateMetadata={templateCalculateMetadata}
  />
);

registerRoot(RemotionRoot);
`;

  await fsp.writeFile(wrapperPath, wrapper, 'utf8');
  return wrapperPath;
}

async function run() {
  const payload = JSON.parse(await readStdin()) as SandboxPayload;

  if (!payload.bundleZipPath) {
    throw new Error('bundleZipPath es requerido.');
  }

  const bundleZipPath = path.resolve(payload.bundleZipPath);
  if (!fs.existsSync(bundleZipPath)) {
    throw new Error(`No se encontro el ZIP del bundle: ${bundleZipPath}`);
  }

  const workDir = path.join(
    path.dirname(bundleZipPath),
    `sandbox-${payload.jobId || Date.now()}-${payload.templateVersionId || 'template'}`,
  );
  const extractDir = path.join(workDir, 'template');
  const outDir = path.join(workDir, 'remotion-bundle');
  const outputPath = path.join(workDir, 'output.mp4');

  log('Extrayendo bundle externo', { bundleZipPath, extractDir });
  await extractZip(bundleZipPath, extractDir);

  const wrapperEntry = await createWrapperEntry({
    extractDir,
    entryPoint: payload.entryPoint || 'src/index.tsx',
    compositionId: payload.compositionId,
    inputProps: payload.inputProps || {},
  });

  const moduleDirs = resolveNodeModules();
  log('Compilando bundle externo', { wrapperEntry, moduleDirs });
  const serveUrl = await bundle({
    entryPoint: wrapperEntry,
    outDir,
    webpackOverride: (config) => {
      config.resolve = config.resolve || {};
      config.resolve.modules = [...moduleDirs, ...(config.resolve.modules || []), 'node_modules'];
      return config;
    },
  });

  await ensureBrowser();
  const composition = await selectComposition({
    serveUrl,
    id: payload.compositionId,
    inputProps: payload.inputProps as Record<string, unknown>,
  });

  log('Renderizando composicion externa', { compositionId: payload.compositionId, outputPath });
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps: payload.inputProps as Record<string, unknown>,
  });

  process.stdout.write(JSON.stringify({ outputPath }));
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || 'Error desconocido');
  process.stdout.write(JSON.stringify({ error: message.slice(0, 1000) }));
  process.exit(1);
});

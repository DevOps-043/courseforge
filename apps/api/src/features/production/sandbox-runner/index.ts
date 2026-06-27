import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import type { ExternalTemplateSandboxRequest } from '../external-template-sandbox-runner.service';
import { getOrBuildBundle } from './bundle-cache';
import { adaptToExternalTemplateProps } from './props-adapter';

const MAX_STDIN_BYTES = 1024 * 1024;
const DEFAULT_RENDER_TIMEOUT_MS = 180 * 1000;

function log(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.error('[SandboxRunner]', message, meta);
    return;
  }

  console.error('[SandboxRunner]', message);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
      if (Buffer.byteLength(data, 'utf8') > MAX_STDIN_BYTES) {
        reject(new Error('Sandbox request exceeds maximum stdin size.'));
        process.stdin.destroy();
      }
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid sandbox request: ${fieldName} is required.`);
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function validateRequest(value: unknown): ExternalTemplateSandboxRequest {
  const request = value as Partial<ExternalTemplateSandboxRequest>;
  const exportMode = request.exportMode === 'root' ? 'root' : 'component';
  const propsMode = request.propsMode === 'resolved' ? 'resolved' : 'assembly';
  const serveUrl = optionalString(request.serveUrl);
  const bundleZipPath = optionalString(request.bundleZipPath);
  const entryPoint = optionalString(request.entryPoint);

  if (!serveUrl && (!bundleZipPath || !entryPoint)) {
    throw new Error('Invalid sandbox request: serveUrl or bundleZipPath + entryPoint is required.');
  }

  return {
    jobId: requireString(request.jobId, 'jobId'),
    templateVersionId: requireString(request.templateVersionId, 'templateVersionId'),
    bundleHash: requireString(request.bundleHash, 'bundleHash'),
    bundleZipPath,
    serveUrl,
    entryPoint,
    compositionId: requireString(request.compositionId, 'compositionId'),
    exportMode,
    propsMode,
    defaultDurationInFrames: optionalPositiveNumber(request.defaultDurationInFrames),
    defaultFps: optionalPositiveNumber(request.defaultFps),
    defaultWidth: optionalPositiveNumber(request.defaultWidth),
    defaultHeight: optionalPositiveNumber(request.defaultHeight),
    inputProps: request.inputProps ?? {},
    assetAllowlist: Array.isArray(request.assetAllowlist)
      ? request.assetAllowlist.filter((url): url is string => typeof url === 'string')
      : [],
  };
}

async function main(): Promise<void> {
  const payload = await readStdin();
  const parsedPayload = JSON.parse(payload);
  const request = validateRequest(parsedPayload);
  const startedAt = Date.now();

  log('Request received.', {
    jobId: request.jobId,
    templateVersionId: request.templateVersionId,
    bundleHash: request.bundleHash,
    entryPoint: request.entryPoint,
    compositionId: request.compositionId,
    exportMode: request.exportMode,
    propsMode: request.propsMode,
    assetAllowlistCount: request.assetAllowlist.length,
  });

  const { serveUrl } = request.serveUrl
    ? { serveUrl: request.serveUrl }
    : await getOrBuildBundle({
        bundleZipPath: requireString(request.bundleZipPath, 'bundleZipPath'),
        bundleHash: request.bundleHash,
        entryPoint: requireString(request.entryPoint, 'entryPoint'),
        compositionId: request.compositionId,
        exportMode: request.exportMode,
        defaultDurationInFrames: request.defaultDurationInFrames,
        defaultFps: request.defaultFps,
        defaultWidth: request.defaultWidth,
        defaultHeight: request.defaultHeight,
      });
  log('Bundle ready.', {
    jobId: request.jobId,
    serveUrl,
    elapsedMs: Date.now() - startedAt,
  });

  await ensureBrowser();
  log('Browser ready.', { jobId: request.jobId, elapsedMs: Date.now() - startedAt });

  const inputProps =
    request.propsMode === 'resolved'
      ? ((request.inputProps ?? {}) as Record<string, unknown>)
      : adaptToExternalTemplateProps(request.inputProps);
  const timeoutInMilliseconds = Number(
    process.env.EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS || DEFAULT_RENDER_TIMEOUT_MS,
  );
  const composition = await selectComposition({
    serveUrl,
    id: request.compositionId,
    inputProps,
    timeoutInMilliseconds,
  });
  log('Composition selected.', {
    jobId: request.jobId,
    compositionId: composition.id,
    durationInFrames: composition.durationInFrames,
    fps: composition.fps,
    width: composition.width,
    height: composition.height,
    timeoutInMilliseconds,
  });

  const outputDir = path.join(os.tmpdir(), `courseforge-sandbox-out-${request.jobId}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, 'output.mp4');
  let lastProgressLog = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
    timeoutInMilliseconds,
    onProgress: ({ progress }) => {
      const rounded = Math.floor(progress * 100);
      if (rounded >= lastProgressLog + 5 || rounded === 100) {
        lastProgressLog = rounded;
        log('Render progress.', {
          jobId: request.jobId,
          progress: rounded,
          elapsedMs: Date.now() - startedAt,
        });
      }
    },
  });
  log('Render completed.', {
    jobId: request.jobId,
    outputPath,
    elapsedMs: Date.now() - startedAt,
  });

  process.stdout.write(JSON.stringify({ outputPath }));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown sandbox runner error.');
  log('Render failed.', { error: message.slice(0, 1000) });
  process.stdout.write(JSON.stringify({ error: message.slice(0, 1000) }));
  process.exit(1);
});

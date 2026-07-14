import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ensureBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { resolveExternalPreviewRenderTimeoutMs } from './remotion-render.config';

const PREVIEW_RENDER_ROOT = path.join(os.tmpdir(), 'courseforge-external-preview-renders');
const DEFAULT_PREVIEW_MAX_SECONDS = 6;

export interface ExternalPreviewRenderInput {
  buildId: string;
  serveUrl: string;
  compositionId: string;
  inputProps: Record<string, unknown>;
  propsHash: string;
}

export interface ExternalPreviewRenderResult {
  fileName: string;
  outputPath: string;
  posterFileName: string;
  posterPath: string;
  previewDurationSeconds: number;
  previewFrames: number;
  compositionDurationSeconds: number;
  compositionFrames: number;
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96);
}

function optionalPositiveNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolvePreviewMaxFrames(fps: number): { frames: number; seconds: number } {
  const maxSeconds = optionalPositiveNumber(process.env.EXTERNAL_TEMPLATE_PREVIEW_MAX_SECONDS);
  if (maxSeconds) {
    return {
      frames: Math.max(1, Math.ceil(maxSeconds * fps)),
      seconds: maxSeconds,
    };
  }

  const legacyMaxFrames = optionalPositiveNumber(process.env.EXTERNAL_TEMPLATE_PREVIEW_MAX_FRAMES);
  if (legacyMaxFrames) {
    const frames = Math.max(1, Math.ceil(legacyMaxFrames));
    return {
      frames,
      seconds: frames / fps,
    };
  }

  return {
    frames: Math.max(1, Math.ceil(DEFAULT_PREVIEW_MAX_SECONDS * fps)),
    seconds: DEFAULT_PREVIEW_MAX_SECONDS,
  };
}

export function getExternalPreviewRenderRoot(): string {
  return PREVIEW_RENDER_ROOT;
}

export function getExternalPreviewRenderPath(fileName: string): string {
  return path.join(PREVIEW_RENDER_ROOT, fileName);
}

export async function renderExternalPreviewVideo(
  input: ExternalPreviewRenderInput,
): Promise<ExternalPreviewRenderResult> {
  const timeoutInMilliseconds = resolveExternalPreviewRenderTimeoutMs();

  await fsp.mkdir(PREVIEW_RENDER_ROOT, { recursive: true });
  await ensureBrowser();

  const composition = await selectComposition({
    serveUrl: input.serveUrl,
    id: input.compositionId,
    inputProps: input.inputProps,
    timeoutInMilliseconds,
  });
  const maxPreview = resolvePreviewMaxFrames(composition.fps);
  const maxFrames = maxPreview.frames;
  const cacheSegment = `${sanitizeFileSegment(input.buildId)}-${sanitizeFileSegment(input.propsHash)}-${maxFrames}f`;
  const fileName = `${cacheSegment}.mp4`;
  const posterFileName = `${cacheSegment}.png`;
  const outputPath = getExternalPreviewRenderPath(fileName);
  const posterPath = getExternalPreviewRenderPath(posterFileName);

  if (fs.existsSync(outputPath) && fs.existsSync(posterPath)) {
    return {
      fileName,
      outputPath,
      posterFileName,
      posterPath,
      previewDurationSeconds: Math.min(maxPreview.seconds, composition.durationInFrames / composition.fps),
      previewFrames: Math.min(maxFrames, composition.durationInFrames),
      compositionDurationSeconds: composition.durationInFrames / composition.fps,
      compositionFrames: composition.durationInFrames,
    };
  }

  const frameRangeEnd = Math.max(0, Math.min(composition.durationInFrames - 1, maxFrames - 1));
  const posterFrame = Math.max(0, Math.min(composition.durationInFrames - 1, Math.min(30, frameRangeEnd)));

  if (!fs.existsSync(posterPath)) {
    await renderStill({
      serveUrl: input.serveUrl,
      composition,
      inputProps: input.inputProps,
      output: posterPath,
      frame: posterFrame,
      timeoutInMilliseconds,
    });
  }

  if (!fs.existsSync(outputPath)) {
    await renderMedia({
      composition,
      serveUrl: input.serveUrl,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps: input.inputProps,
      frameRange: [0, frameRangeEnd],
      timeoutInMilliseconds,
      overwrite: true,
    });
  }

  return {
    fileName,
    outputPath,
    posterFileName,
    posterPath,
    previewDurationSeconds: Math.min(maxPreview.seconds, composition.durationInFrames / composition.fps),
    previewFrames: Math.min(maxFrames, composition.durationInFrames),
    compositionDurationSeconds: composition.durationInFrames / composition.fps,
    compositionFrames: composition.durationInFrames,
  };
}

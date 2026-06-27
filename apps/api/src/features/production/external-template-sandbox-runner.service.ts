import { spawn } from 'child_process';
import * as path from 'path';

export interface ExternalTemplateSandboxRequest {
  jobId: string;
  templateVersionId: string;
  bundleHash: string;
  bundleZipPath?: string;
  serveUrl?: string;
  entryPoint?: string;
  compositionId: string;
  exportMode?: 'component' | 'root';
  propsMode?: 'assembly' | 'resolved';
  defaultDurationInFrames?: number;
  defaultFps?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  inputProps: unknown;
  assetAllowlist: string[];
}

export interface ExternalTemplateSandboxResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  metrics?: {
    durationMs: number;
    timedOut: boolean;
  };
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_LOG_BYTES = 4000;

function parseSandboxCommand(rawCommand: string): { command: string; args: string[] } {
  const parts = rawCommand.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) || [];
  if (parts.length === 0) {
    throw new Error('EXTERNAL_TEMPLATE_SANDBOX_COMMAND esta vacio.');
  }
  return { command: parts[0], args: parts.slice(1) };
}

function sanitizeMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value || 'Error desconocido');
  return message
    .replace(/SUPABASE_SERVICE_ROLE_KEY=[^\s]+/gi, 'SUPABASE_SERVICE_ROLE_KEY=[redacted]')
    .replace(/OPENAI_API_KEY=[^\s]+/gi, 'OPENAI_API_KEY=[redacted]')
    .replace(/GOOGLE_GENERATIVE_AI_API_KEY=[^\s]+/gi, 'GOOGLE_GENERATIVE_AI_API_KEY=[redacted]')
    .slice(0, 1000);
}

function buildSandboxEnv() {
  const allowedKeys = [
    'NODE_ENV',
    'PATH',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  env.COURSEFORGE_SANDBOX_RUNNER = '1';
  return env;
}

function summarizeRequest(request: ExternalTemplateSandboxRequest) {
  const inputProps = request.inputProps as Record<string, unknown> | null | undefined;

  return {
    jobId: request.jobId,
    templateVersionId: request.templateVersionId,
    bundleHash: request.bundleHash,
    entryPoint: request.entryPoint,
    compositionId: request.compositionId,
    exportMode: request.exportMode,
    propsMode: request.propsMode,
    bundleZipPath: request.bundleZipPath,
    serveUrl: request.serveUrl,
    assetAllowlistCount: request.assetAllowlist.length,
    slidesCount: Array.isArray(inputProps?.slides) ? inputProps.slides.length : 0,
    brollClipsCount: Array.isArray(inputProps?.brollClips) ? inputProps.brollClips.length : 0,
    hasAvatarVideo: typeof inputProps?.avatarVideoUrl === 'string',
    totalDurationInFrames: inputProps?.totalDurationInFrames,
    fps: inputProps?.fps,
  };
}

function logSandboxStderr(stderr: string): void {
  const trimmed = sanitizeMessage(stderr).trim();
  if (!trimmed) {
    return;
  }

  console.log('[ExternalTemplateSandboxRunner] Child stderr:', trimmed.slice(0, MAX_LOG_BYTES));
}

function resolveSandboxTimeoutMs(request: ExternalTemplateSandboxRequest): number {
  const configured = Number(process.env.EXTERNAL_TEMPLATE_SANDBOX_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  const inputProps = request.inputProps as Record<string, unknown> | null | undefined;
  const totalDurationInFrames = typeof inputProps?.totalDurationInFrames === 'number'
    ? inputProps.totalDurationInFrames
    : request.defaultDurationInFrames;
  const fps = typeof inputProps?.fps === 'number' && inputProps.fps > 0
    ? inputProps.fps
    : request.defaultFps;

  if (!totalDurationInFrames || !fps) {
    return DEFAULT_TIMEOUT_MS;
  }

  const durationSeconds = totalDurationInFrames / fps;
  const durationAwareTimeoutMs = Math.ceil(2 * 60 * 1000 + durationSeconds * 20 * 1000);
  return Math.min(MAX_TIMEOUT_MS, Math.max(DEFAULT_TIMEOUT_MS, durationAwareTimeoutMs));
}

function parseRunnerOutput(stdout: string): { outputPath?: string; error?: string } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {};
  }

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const lastJsonObject = trimmed.match(/\{[\s\S]*\}\s*$/);
    if (!lastJsonObject) {
      throw new Error('Sandbox runner did not return valid JSON.');
    }
    parsed = JSON.parse(lastJsonObject[0]);
  }

  return {
    outputPath: typeof parsed.outputPath === 'string' ? path.resolve(parsed.outputPath) : undefined,
    error: typeof parsed.error === 'string' ? parsed.error : undefined,
  };
}

export class ExternalTemplateSandboxRunner {
  public isEnabled(): boolean {
    return process.env.EXTERNAL_TEMPLATE_SANDBOX_ENABLED === 'true';
  }

  public async render(request: ExternalTemplateSandboxRequest): Promise<ExternalTemplateSandboxResult> {
    if (!this.isEnabled()) {
      return { success: false, error: 'External template sandbox is disabled.' };
    }

    const rawCommand = process.env.EXTERNAL_TEMPLATE_SANDBOX_COMMAND;
    if (!rawCommand) {
      return {
        success: false,
        error: 'External template sandbox is enabled but EXTERNAL_TEMPLATE_SANDBOX_COMMAND is not configured.',
      };
    }

    const startedAt = Date.now();
    const timeoutMs = resolveSandboxTimeoutMs(request);

    try {
      const { command, args } = parseSandboxCommand(rawCommand);
      const payload = JSON.stringify(request);

      console.log('[ExternalTemplateSandboxRunner] Spawning sandbox runner.', {
        command,
        args,
        timeoutMs,
        request: summarizeRequest(request),
      });

      return await new Promise<ExternalTemplateSandboxResult>((resolve) => {
        const child = spawn(command, args, {
          env: buildSandboxEnv(),
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timeout = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
          if (stdout.length < MAX_STDOUT_BYTES) {
            stdout += chunk.toString('utf8');
          }
        });

        child.stderr.on('data', (chunk: Buffer) => {
          const chunkText = chunk.toString('utf8');
          if (stderr.length < MAX_STDERR_BYTES) {
            stderr += chunkText;
          }

          const progressLines = chunkText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.includes('[SandboxRunner] Render progress.'));

          for (const line of progressLines) {
            console.log('[ExternalTemplateSandboxRunner] Child progress:', sanitizeMessage(line).slice(0, MAX_LOG_BYTES));
          }
        });

        child.on('error', (error) => {
          clearTimeout(timeout);
          console.error('[ExternalTemplateSandboxRunner] Failed to spawn sandbox runner.', {
            request: summarizeRequest(request),
            error: sanitizeMessage(error),
          });
          resolve({
            success: false,
            error: sanitizeMessage(error),
            metrics: { durationMs: Date.now() - startedAt, timedOut },
          });
        });

        child.on('exit', (code) => {
          clearTimeout(timeout);
          const metrics = { durationMs: Date.now() - startedAt, timedOut };

          if (timedOut) {
            console.error('[ExternalTemplateSandboxRunner] Sandbox runner timed out.', {
              request: summarizeRequest(request),
              metrics,
            });
            resolve({ success: false, error: 'Sandbox render timed out.', metrics });
            return;
          }

          try {
            const parsedOutput = parseRunnerOutput(stdout);
            if (code === 0 && parsedOutput.outputPath) {
              logSandboxStderr(stderr);
              console.log('[ExternalTemplateSandboxRunner] Sandbox runner completed successfully.', {
                request: summarizeRequest(request),
                outputPath: parsedOutput.outputPath,
                metrics,
              });
              resolve({ success: true, outputPath: parsedOutput.outputPath, metrics });
              return;
            }

            logSandboxStderr(stderr);
            console.warn('[ExternalTemplateSandboxRunner] Sandbox runner exited without a usable output.', {
              request: summarizeRequest(request),
              exitCode: code,
              stdout: sanitizeMessage(stdout).slice(0, MAX_LOG_BYTES),
              stderr: sanitizeMessage(stderr).slice(0, MAX_LOG_BYTES),
              parsedError: parsedOutput.error,
              metrics,
            });
            resolve({
              success: false,
              error: sanitizeMessage(parsedOutput.error || stderr || `Sandbox process exited with code ${code}.`),
              metrics,
            });
          } catch (error) {
            logSandboxStderr(stderr);
            console.error('[ExternalTemplateSandboxRunner] Failed to parse sandbox runner output.', {
              request: summarizeRequest(request),
              stdout: sanitizeMessage(stdout).slice(0, MAX_LOG_BYTES),
              stderr: sanitizeMessage(stderr).slice(0, MAX_LOG_BYTES),
              error: sanitizeMessage(error),
              metrics,
            });
            resolve({
              success: false,
              error: sanitizeMessage(error),
              metrics,
            });
          }
        });

        child.stdin.end(payload);
      });
    } catch (error) {
      return {
        success: false,
        error: sanitizeMessage(error),
        metrics: { durationMs: Date.now() - startedAt, timedOut: false },
      };
    }
  }
}

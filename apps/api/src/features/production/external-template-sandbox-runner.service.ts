import { spawn } from 'child_process';
import * as path from 'path';

export interface ExternalTemplateSandboxRequest {
  jobId: string;
  templateVersionId: string;
  bundleHash: string;
  bundleZipPath: string;
  entryPoint: string;
  compositionId: string;
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
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

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
    const timeoutMs = Number(process.env.EXTERNAL_TEMPLATE_SANDBOX_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

    try {
      const { command, args } = parseSandboxCommand(rawCommand);
      const payload = JSON.stringify(request);

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
          if (stderr.length < MAX_STDERR_BYTES) {
            stderr += chunk.toString('utf8');
          }
        });

        child.on('error', (error) => {
          clearTimeout(timeout);
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
            resolve({ success: false, error: 'Sandbox render timed out.', metrics });
            return;
          }

          try {
            const parsedOutput = parseRunnerOutput(stdout);
            if (code === 0 && parsedOutput.outputPath) {
              resolve({ success: true, outputPath: parsedOutput.outputPath, metrics });
              return;
            }

            resolve({
              success: false,
              error: sanitizeMessage(parsedOutput.error || stderr || `Sandbox process exited with code ${code}.`),
              metrics,
            });
          } catch (error) {
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

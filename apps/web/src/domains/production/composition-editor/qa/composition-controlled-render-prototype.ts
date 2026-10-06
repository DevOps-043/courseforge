import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { assertConformanceFileUnchanged, pinConformanceFile } from "./composition-conformance-file-integrity";
import { parseExportedVideoProbe } from "./composition-exported-video-conformance";
import {createControlledRenderDeadline, CONTROLLED_RENDER_DEADLINE_POLICY} from "./composition-controlled-render-deadline";
import {createControlledProcessEnvironment} from "./composition-controlled-process-environment";

const executeFile = promisify(execFile);
const MAX_TOOL_BYTES = 1024 ** 3;
const MAX_PROJECT_FILE_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
const PROCESS_OUTPUT_BYTES = 256 * 1024;
export const CONTROLLED_HYPERFRAMES_VERSION = "0.7.106";
const TOOL_ROLES = ["node", "package", "cli", "runtime", "browser", "ffmpeg", "ffprobe"] as const;
type ToolRole = typeof TOOL_ROLES[number];
type PinnedInput = {path: string; sha256: string};
type ProcessOptions = {cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number;
  windowsHide: boolean; encoding: "utf8"; signal?: AbortSignal};
export type ControlledPrototypeExecutor = (binary: string, args: string[], options: ProcessOptions) => Promise<{stdout: string}>;
export type ControlledRenderPrototypeInput = {
  /** This prototype has no OS/container isolation. Never accept uploaded/untrusted HTML here. */
  trustedLocalSyntheticProject: true;
  projectDirectory: string; outputParentDirectory: string;
  tools: Record<ToolRole, PinnedInput>;
  projectFiles: Array<PinnedInput & {id: string}>;
  fps: 24 | 25 | 30 | 60; quality: "draft" | "standard" | "high";
  width: number; height: number; durationSeconds: number; timeoutMs: number; signal?: AbortSignal;
};

/** Executes the official pinned CLI, not a substitute capture/animation engine. Not a production attestation. */
export async function renderControlledLocalPrototype(input: ControlledRenderPrototypeInput,
  execute: ControlledPrototypeExecutor = executeFile) {
  validateInput(input);
  const deadline = createControlledRenderDeadline(input.timeoutMs, input.signal);
  try {
    return await deadline.run(() => renderWithinDeadline({...input, signal: deadline.signal},
      (binary, args, options) => deadline.run((signal, remainingMs) => execute(binary, args,
        {...options, signal, timeout: Math.min(options.timeout, remainingMs)}))));
  } catch (error) {
    if (error instanceof Error && /^(CONTROLLED_RENDER|CONFORMANCE_FILE)_[A-Z_]+$/.test(error.message)) throw error;
    throw new Error("CONTROLLED_RENDER_PREPARATION_FAILED");
  } finally {deadline.dispose();}
}

async function renderWithinDeadline(input: ControlledRenderPrototypeInput, execute: ControlledPrototypeExecutor) {
  const assertActive = () => {if (input.signal?.aborted) throw new Error("CONTROLLED_RENDER_ABORTED");};
  assertActive();
  for (const path of [input.projectDirectory, input.outputParentDirectory]) {
    const directory = await lstat(path);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("CONTROLLED_RENDER_DIRECTORY_INVALID");
  }
  const entries = [
    ...TOOL_ROLES.map((role) => ({id: role, ...input.tools[role], maximumBytes: MAX_TOOL_BYTES})),
    ...input.projectFiles.map((file) => ({...file, maximumBytes: MAX_PROJECT_FILE_BYTES})),
  ];
  const pinned = await Promise.all(entries.map(async (entry) => {
    const pin = await pinConformanceFile(entry.path, entry.maximumBytes);
    if (pin.sha256 !== entry.sha256) throw new Error("CONTROLLED_RENDER_INPUT_HASH_MISMATCH");
    return {...entry, pin};
  }));
  const metadata = JSON.parse(await readFile(input.tools.package.path, "utf8")) as {name?: string; version?: string};
  if (metadata.name !== "hyperframes" || metadata.version !== CONTROLLED_HYPERFRAMES_VERSION
    || input.tools.package.path !== join(dirname(input.tools.cli.path), "..", "package.json")
    || input.tools.runtime.path !== join(dirname(input.tools.cli.path), "hyperframe-runtime.js"))
    throw new Error("CONTROLLED_RENDER_EXECUTOR_VERSION_MISMATCH");
  assertActive();
  const directory = await mkdtemp(join(input.outputParentDirectory, "controlled-render-"));
  const videoPath = join(directory, "final.mp4");
  // Deliberate allowlist: never inherit DB/API credentials or caller-supplied producer overrides.
  const env = createControlledProcessEnvironment();
  Object.assign(env, {
    HYPERFRAMES_NO_TELEMETRY: "1", PRODUCER_HEADLESS_SHELL_PATH: input.tools.browser.path,
    HYPERFRAMES_FFMPEG_PATH: input.tools.ffmpeg.path, HYPERFRAMES_FFPROBE_PATH: input.tools.ffprobe.path,
    PRODUCER_MAX_WORKERS: "1", PRODUCER_ENABLE_BROWSER_POOL: "false", PRODUCER_VERIFY_HYPERFRAME_RUNTIME: "true",
  });
  const options: ProcessOptions = {cwd: input.projectDirectory, env, timeout: input.timeoutMs,
    maxBuffer: PROCESS_OUTPUT_BYTES, windowsHide: true, encoding: "utf8", signal: input.signal};
  let stage = "RENDER";
  try {
    assertActive();
    await execute(input.tools.node.path, [input.tools.cli.path, "render", input.projectDirectory,
      "--output", videoPath, "--fps", String(input.fps), "--quality", input.quality,
      "--format", "mp4", "--workers", "1", "--sdr", "--no-browser-gpu", "--strict", "--no-best-effort"], options);
    assertActive(); stage = "PROBE";
    const output = await pinConformanceFile(videoPath, MAX_OUTPUT_BYTES);
    const {stdout} = await execute(input.tools.ffprobe.path, ["-v", "error", "-protocol_whitelist", "file,pipe",
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,color_space,color_primaries,color_transfer,color_range", "-of", "json", videoPath],
    {...options, timeout: Math.min(input.timeoutMs, 30_000)});
    if (Buffer.byteLength(stdout) > PROCESS_OUTPUT_BYTES) throw new Error("CONTROLLED_RENDER_PROBE_LIMIT");
    const probe = parseExportedVideoProbe(JSON.parse(stdout) as unknown);
    if (probe.width !== input.width || probe.height !== input.height || probe.fps !== input.fps || probe.codec !== "h264"
      || Math.abs(probe.durationSeconds - input.durationSeconds) > 1 / input.fps)
      throw new Error("CONTROLLED_RENDER_OUTPUT_PROFILE_MISMATCH");
    assertActive(); stage = "INTEGRITY";
    await Promise.all(pinned.map((file) => assertConformanceFileUnchanged(file.path, file.pin, file.maximumBytes)));
    await assertConformanceFileUnchanged(videoPath, output, MAX_OUTPUT_BYTES);
    const descriptor = {version: 1, cliVersion: CONTROLLED_HYPERFRAMES_VERSION,
      deadline: {policy: CONTROLLED_RENDER_DEADLINE_POLICY.id, totalMilliseconds: input.timeoutMs},
      profile: {fps: input.fps, quality: input.quality, width: input.width, height: input.height, durationSeconds: input.durationSeconds},
      inputs: pinned.map((file) => ({id: file.id, sha256: file.pin.sha256, sizeBytes: file.pin.sizeBytes}))};
    return {directory, videoPath, receipt: {scope: "LOCAL_RENDER_NOT_PRODUCTION_ATTESTATION" as const, descriptor,
      descriptorSha256: createHash("sha256").update(JSON.stringify(descriptor)).digest("hex"),
      output: {sha256: output.sha256, sizeBytes: output.sizeBytes}, probe,
      incomplete: ["BROWSER_SESSION_IDENTITY", "EFFECTIVE_FONTS", "SDR_CONVERSION", "ISOLATION_AND_PROCESS_TREE",
        "DEPENDENCY_CLOSURE", "DURABLE_TENANT_JOB_BINDING", "PREVIEW_RENDER_COMPARISON"]}};
  } catch (error) {
    if (input.signal?.aborted) {
      const reason = input.signal.reason;
      throw new Error(reason instanceof Error && reason.message === "CONTROLLED_RENDER_DEADLINE_EXCEEDED"
        ? reason.message : "CONTROLLED_RENDER_ABORTED");
    }
    if (error instanceof Error && /^(CONTROLLED_RENDER|CONFORMANCE_FILE)_[A-Z_]+$/.test(error.message)) throw error;
    // Do not release arbitrary CLI stderr, signed URLs, paths, or educational content.
    throw new Error(`CONTROLLED_RENDER_${stage}_FAILED`);
  }
}

function validateInput(input: ControlledRenderPrototypeInput) {
  const paths = [input.projectDirectory, input.outputParentDirectory, ...TOOL_ROLES.map((role) => input.tools[role]?.path),
    ...input.projectFiles.map((file) => file.path)];
  const files = [...TOOL_ROLES.map((role) => input.tools[role]), ...input.projectFiles];
  const ids = [...TOOL_ROLES, ...input.projectFiles.map((file) => file.id)];
  if (input.trustedLocalSyntheticProject !== true || !paths.every((path) => typeof path === "string" && isAbsolute(path) && !path.includes("\0"))
    || !files.every((file) => /^[a-f0-9]{64}$/.test(file?.sha256)) || input.projectFiles.length < 1 || input.projectFiles.length > 256
    || new Set(ids).size !== ids.length || !ids.every((id) => /^[a-zA-Z0-9_-]{1,80}$/.test(id))
    || !input.projectFiles.some((file) => file.path === join(input.projectDirectory, "index.html"))
    || ![24, 25, 30, 60].includes(input.fps) || !["draft", "standard", "high"].includes(input.quality)
    || ![input.width, input.height].every((value) => Number.isSafeInteger(value) && value > 0 && value <= 1920)
    || !Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > 30
    || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < CONTROLLED_RENDER_DEADLINE_POLICY.minimumMilliseconds
    || input.timeoutMs > CONTROLLED_RENDER_DEADLINE_POLICY.maximumMilliseconds)
    throw new Error("CONTROLLED_RENDER_ARGUMENTS_INVALID");
}

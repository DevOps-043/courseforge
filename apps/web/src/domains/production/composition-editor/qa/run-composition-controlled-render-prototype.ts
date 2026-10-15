import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { RenderInternals } from "@remotion/renderer";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import { NATIVE_CONFORMANCE_CORPUS_FPS } from "./composition-native-conformance-corpus";
import { compileControlledRenderCorpus } from "./composition-controlled-render-corpus";
import { pinConformanceFile } from "./composition-conformance-file-integrity";
import { renderControlledLocalPrototype, type ControlledRenderPrototypeInput } from "./composition-controlled-render-prototype";
import { auditControlledRenderColor } from "./composition-controlled-render-color-audit";
import {createControlledRenderDeadline, CONTROLLED_RENDER_DEADLINE_POLICY} from "./composition-controlled-render-deadline";
import {createControlledProcessEnvironment} from "./composition-controlled-process-environment";

const executeFile = promisify(execFile);

/** Synthetic compatibility smoke only. Does not accept user projects or change the production backend. */
async function main() {
  const deadline = createControlledRenderDeadline(CONTROLLED_RENDER_DEADLINE_POLICY.maximumMilliseconds);
  try {await deadline.run(() => runWithinDeadline(deadline));}
  finally {deadline.dispose();}
}

async function runWithinDeadline(deadline: ReturnType<typeof createControlledRenderDeadline>) {
  const values = process.argv.slice(2), args = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index], value = values[index + 1];
    if (!key || !["--executor-root", "--browser", "--output-parent", "--fps", "--trusted-local-synthetic"].includes(key)
      || args.has(key) || !value || value.startsWith("--")) throw new Error("CONTROLLED_RENDER_ARGUMENTS_INVALID");
    args.set(key, value);
  }
  if (args.get("--trusted-local-synthetic") !== "yes" || !args.get("--executor-root") || !args.get("--browser") || !args.get("--output-parent"))
    throw new Error("CONTROLLED_RENDER_ARGUMENTS_INVALID");
  const fps = Number(args.get("--fps"));
  if (!NATIVE_CONFORMANCE_CORPUS_FPS.some((approved) => approved === fps)) throw new Error("CONTROLLED_RENDER_ARGUMENTS_INVALID");
  const root = resolve(args.get("--executor-root")!), parent = resolve(args.get("--output-parent")!);
  const {fixture, html} = await compileControlledRenderCorpus(fps as typeof NATIVE_CONFORMANCE_CORPUS_FPS[number]);
  const project = await mkdtemp(join(parent, "controlled-render-project-"));
  await mkdir(join(project, "assets"));
  const runtime = join(root, "dist", "hyperframe-runtime.js");
  const entry = join(project, "index.html"), gsap = join(project, "assets", "gsap.min.js");
  await writeFile(gsap, await readFile(require.resolve("gsap/dist/gsap.min.js")), {flag: "wx"});
  // The producer owns runtime/bootstrap injection. Export bootstrap markers in authored
  // body scripts would be merged with the timeline and stripped by the official server.
  await writeFile(entry, html, {flag: "wx"});
  const paths = {node: process.execPath, package: join(root, "package.json"), cli: join(root, "dist", "cli.js"), runtime,
    browser: resolve(args.get("--browser")!), ffmpeg: binary("ffmpeg"), ffprobe: binary("ffprobe")};
  const tools = {} as ControlledRenderPrototypeInput["tools"];
  for (const [role, path] of Object.entries(paths)) tools[role as keyof typeof tools] = {path, sha256: (await pinConformanceFile(path, 1024 ** 3)).sha256};
  const projectFiles = await Promise.all([entry, gsap].map(async (path, index) =>
    ({id: ["entry", "gsap"][index]!, path, sha256: (await pinConformanceFile(path, 100 * 1024 * 1024)).sha256})));
  const remainingMs = deadline.remainingMilliseconds();
  if (remainingMs < CONTROLLED_RENDER_DEADLINE_POLICY.minimumMilliseconds)
    throw new Error("CONTROLLED_RENDER_DEADLINE_INSUFFICIENT_BUDGET");
  const result = await renderControlledLocalPrototype({trustedLocalSyntheticProject: true, projectDirectory: project,
    outputParentDirectory: parent, tools, projectFiles, fps: fixture.document.canvas.fps as ControlledRenderPrototypeInput["fps"],
    quality: "high", width: fixture.document.canvas.width, height: fixture.document.canvas.height,
    durationSeconds: fixture.document.canvas.durationSeconds, timeoutMs: remainingMs, signal: deadline.signal});
  if (!fixture.colorAuditPlan) throw new Error("CONTROLLED_RENDER_COLOR_PLAN_MISSING");
  const colorAudit = await auditControlledRenderColor({videoPath: result.videoPath, videoSha256: result.receipt.output.sha256,
    ffmpegPath: tools.ffmpeg.path, ffmpegSha256: tools.ffmpeg.sha256, plan: fixture.colorAuditPlan,
    fps: fixture.document.canvas.fps as ControlledRenderPrototypeInput["fps"], durationSeconds: fixture.document.canvas.durationSeconds,
    signal: deadline.signal}, (binaryPath, decodeArgs, options) => deadline.run((signal, remaining) =>
      executeFile(binaryPath, decodeArgs, {...options, env: createControlledProcessEnvironment(), signal,
        timeout: Math.min(options.timeout, remaining)})));
  if (colorAudit.status !== "PASS") throw new Error("CONTROLLED_RENDER_COLOR_AUDIT_FAILED");
  const receiptPath = join(result.directory, "receipt.json");
  await deadline.run(() => writeFile(receiptPath, JSON.stringify({...result.receipt, colorAudit, corpusCaseSha256: fixture.caseSha256,
    workflowDeadline: {policy: CONTROLLED_RENDER_DEADLINE_POLICY.id, totalMilliseconds: CONTROLLED_RENDER_DEADLINE_POLICY.maximumMilliseconds},
    documentHash: fixture.documentHash}, null, 2), {flag: "wx", mode: 0o600}));
  deadline.remainingMilliseconds();
  process.stdout.write(`${JSON.stringify({scope: result.receipt.scope, videoPath: result.videoPath, receiptPath,
    outputSha256: result.receipt.output.sha256, colorAuditStatus: colorAudit.status, incomplete: result.receipt.incomplete})}\n`);
}
function binary(type: "ffmpeg" | "ffprobe") {
  return RenderInternals.getExecutablePath({binariesDirectory: null, indent: false, logLevel: "error", type});
}
void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error && /^(CONTROLLED_RENDER|CONFORMANCE_FILE)_[A-Z_]+$/.test(error.message)
    ? error.message : "CONTROLLED_RENDER_PROTOTYPE_FAILED"}\n`); process.exitCode = 1;
});

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseFinalVideoGateArguments, runFinalVideoGate } from "./composition-final-video-gate.mjs";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const integrityEntry = fileURLToPath(new URL("../apps/api/dist/features/video-integrity/verify-entry.js", import.meta.url));

async function main() {
  const options = parseFinalVideoGateArguments(process.argv.slice(2));
  const { compareExportedVideoWithPreview } = require("../apps/web/dist/composition-worker/domains/production/composition-editor/qa/composition-exported-video-conformance.js");
  const report = await runFinalVideoGate(options, {
    async checkIntegrity(organizationId, requestId) {
      const { stdout } = await execute(process.execPath, [integrityEntry, "--check-only", organizationId, requestId], {
        cwd: workspaceRoot, timeout: 20 * 60 * 1000, maxBuffer: 128 * 1024, windowsHide: true,
      });
      // dotenv may emit non-JSON diagnostics; the integrity entry emits its result last.
      return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
    },
    compareVideo: compareExportedVideoWithPreview,
  });
  process.stdout.write(`${report.status}: integridad revalidada y reporte vinculado; timing ${report.comparison.audioTiming?.status ?? "NOT_REQUESTED"}.\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}

void main().catch((error) => {
  const code = error instanceof Error && /^FINAL_VIDEO_GATE_[A-Z_]+$/.test(error.message)
    ? error.message : "FINAL_VIDEO_GATE_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});

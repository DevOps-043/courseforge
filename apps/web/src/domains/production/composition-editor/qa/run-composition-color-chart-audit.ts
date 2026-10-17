import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { auditColorChartPng, COLOR_CHART_AUDIT_POLICY } from "./composition-color-chart-audit";
import { buildNativeConformanceCorpusCase, NATIVE_CONFORMANCE_CORPUS_FPS } from "./composition-native-conformance-corpus";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export function parseColorChartAuditArgs(values: string[]) {
  const allowed = new Set(["--fps", "--case-sha256", "--preview-png", "--render-png"]);
  if (values.length !== allowed.size * 2) throw new Error("CONFORMANCE_COLOR_CHART_ARGUMENTS_INVALID");
  const args = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]!, value = values[index + 1]!;
    if (!allowed.has(key) || args.has(key) || !value || value.startsWith("--"))
      throw new Error("CONFORMANCE_COLOR_CHART_ARGUMENTS_INVALID");
    args.set(key, value);
  }
  const fps = Number(args.get("--fps"));
  const caseSha256 = digestSchema.parse(args.get("--case-sha256"));
  const previewPath = args.get("--preview-png")!, renderPath = args.get("--render-png")!;
  if (!NATIVE_CONFORMANCE_CORPUS_FPS.some((approved) => approved === fps)
    || !isAbsolute(previewPath) || !isAbsolute(renderPath) || previewPath === renderPath)
    throw new Error("CONFORMANCE_COLOR_CHART_ARGUMENTS_INVALID");
  return {fps: fps as typeof NATIVE_CONFORMANCE_CORPUS_FPS[number], caseSha256,
    previewPath: resolve(previewPath), renderPath: resolve(renderPath)};
}

async function boundedPng(path: string) {
  const file = await lstat(path);
  if (!file.isFile() || file.size <= 0 || file.size > COLOR_CHART_AUDIT_POLICY.maximumPngBytes)
    throw new Error("CONFORMANCE_COLOR_CHART_FILE_INVALID");
  const bytes = await readFile(path);
  if (bytes.length !== file.size) throw new Error("CONFORMANCE_COLOR_CHART_FILE_CHANGED");
  return bytes;
}

async function main() {
  const args = parseColorChartAuditArgs(process.argv.slice(2));
  const corpus = buildNativeConformanceCorpusCase("color-neutral", args.fps);
  if (corpus.caseSha256 !== args.caseSha256 || !corpus.colorAuditPlan)
    throw new Error("CONFORMANCE_COLOR_CHART_CASE_MISMATCH");
  const [preview, render] = await Promise.all([
    auditColorChartPng({plan: corpus.colorAuditPlan, png: await boundedPng(args.previewPath), documentHash: corpus.documentHash}),
    auditColorChartPng({plan: corpus.colorAuditPlan, png: await boundedPng(args.renderPath), documentHash: corpus.documentHash}),
  ]);
  const status = preview.status === "PASS" && render.status === "PASS" ? "PASS" : "FAIL";
  process.stdout.write(`${JSON.stringify({scope: "LOCAL_CORPUS_RGB_AUDIT_NOT_MP4_PROVENANCE_OR_SDR_ATTESTATION",
    caseSha256: corpus.caseSha256, documentHash: corpus.documentHash, status, preview, render})}\n`);
  if (status !== "PASS") process.exitCode = 1;
}
if (process.argv[1]?.includes("run-composition-color-chart-audit"))
  void main().catch(() => {process.stderr.write("CONFORMANCE_COLOR_CHART_AUDIT_FAILED\n"); process.exitCode = 1;});

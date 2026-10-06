import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compareExportedVideoWithPreview } from "./composition-exported-video-conformance";
import { resolveExportedAudioLoudnessPolicyId } from "./composition-exported-audio-loudness";
import { resolveExportedColorTagPolicyId } from "./composition-exported-color-tags";
import { buildNativeConformanceCorpusCase, NATIVE_CONFORMANCE_CORPUS_FPS } from "./composition-native-conformance-corpus";

async function main() {
  const values = process.argv.slice(2);
  const argumentsByName = new Map<string, string>();
  const allowedArguments = new Set(["contract", "preview-dir", "preview-metadata", "render-receipt", "video", "output", "audio-policy", "color-tag-policy", "audio-reference", "audio-reference-metadata", "color-chart-fps", "color-chart-case-sha256"]);
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("Argumentos inválidos.");
    if (!allowedArguments.has(key.slice(2)) || argumentsByName.has(key.slice(2))) throw new Error("Argumento desconocido o duplicado.");
    argumentsByName.set(key.slice(2), value);
  }
  const required = (name: string) => {
    const value = argumentsByName.get(name);
    if (!value) throw new Error(`Falta --${name}.`);
    return value;
  };
  const chartFps = argumentsByName.get("color-chart-fps");
  const chartCaseSha256 = argumentsByName.get("color-chart-case-sha256");
  if (Boolean(chartFps) !== Boolean(chartCaseSha256)) throw new Error("EXPORTED_COLOR_CHART_ARGUMENTS_INCOMPLETE");
  const fps = chartFps ? Number(chartFps) : undefined;
  if (fps !== undefined && !NATIVE_CONFORMANCE_CORPUS_FPS.some((allowed) => allowed === fps))
    throw new Error("EXPORTED_COLOR_CHART_FPS_INVALID");
  const chartCase = fps !== undefined ? buildNativeConformanceCorpusCase("color-neutral", fps as typeof NATIVE_CONFORMANCE_CORPUS_FPS[number]) : undefined;
  if (chartCase && (!/^[a-f0-9]{64}$/.test(chartCaseSha256!) || chartCase.caseSha256 !== chartCaseSha256))
    throw new Error("EXPORTED_COLOR_CHART_CASE_MISMATCH");
  const report = await compareExportedVideoWithPreview({
    colorChartAuditPlan: chartCase?.colorAuditPlan,
    audioReferencePath: argumentsByName.get("audio-reference"),
    audioReferenceMetadataPath: argumentsByName.get("audio-reference-metadata"),
    audioPolicyId: resolveExportedAudioLoudnessPolicyId(argumentsByName.get("audio-policy")),
    colorTagPolicyId: resolveExportedColorTagPolicyId(argumentsByName.get("color-tag-policy")),
    contractPath: required("contract"),
    previewDirectory: required("preview-dir"),
    previewMetadataPath: required("preview-metadata"),
    renderReceiptPath: required("render-receipt"),
    videoPath: required("video"),
  });
  await writeFile(resolve(argumentsByName.get("output") ?? "composition-exported-video-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${report.status}: ${report.visual.checkedCheckpointCount}/${report.visual.requiredCheckpointCount} checkpoints; audio ${report.audioStatus}; loudness ${report.audioLoudness.status}; timing ${report.audioTiming.status}; color tags ${report.colorTags?.status ?? "NOT_MEASURED"}; carta RGB ${report.colorChart?.status ?? "NOT_REQUESTED"}; procedencia no autenticada.\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

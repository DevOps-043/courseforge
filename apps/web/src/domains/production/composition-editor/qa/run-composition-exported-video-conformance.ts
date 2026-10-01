import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compareExportedVideoWithPreview } from "./composition-exported-video-conformance";
import { resolveExportedAudioLoudnessPolicyId } from "./composition-exported-audio-loudness";
import { resolveExportedColorTagPolicyId } from "./composition-exported-color-tags";

async function main() {
  const values = process.argv.slice(2);
  const argumentsByName = new Map<string, string>();
  const allowedArguments = new Set(["contract", "preview-dir", "preview-metadata", "render-receipt", "video", "output", "audio-policy", "color-tag-policy", "audio-reference", "audio-reference-metadata"]);
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
  const report = await compareExportedVideoWithPreview({
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
  process.stdout.write(`${report.status}: ${report.visual.checkedCheckpointCount}/${report.visual.requiredCheckpointCount} checkpoints; audio ${report.audioStatus}; loudness ${report.audioLoudness.status}; timing ${report.audioTiming.status}; color tags ${report.colorTags?.status ?? "NOT_MEASURED"}; procedencia no autenticada.\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

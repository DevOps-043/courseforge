import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compareCompositionConformanceDirectories } from "./composition-conformance-files";

async function main() {
  const argumentsByName = parseArguments(process.argv.slice(2));
  const contractPath = requiredArgument(argumentsByName, "contract");
  const previewDirectory = requiredArgument(argumentsByName, "preview-dir");
  const renderDirectory = requiredArgument(argumentsByName, "render-dir");
  const previewMetadataPath = requiredArgument(argumentsByName, "preview-metadata");
  const renderMetadataPath = requiredArgument(argumentsByName, "render-metadata");
  const outputPath = argumentsByName.get("output") || "composition-conformance-report.json";
  const report = await compareCompositionConformanceDirectories({
    contractPath,
    previewDirectory,
    previewMetadataPath,
    renderDirectory,
    renderMetadataPath,
  });
  await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${report.status}: ${report.checkedCheckpointCount}/${report.requiredCheckpointCount} checkpoints; ${report.failures.length} diferencias.\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}

function parseArguments(values: string[]) {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    const value = values[index + 1];
    if (key && value) parsed.set(key, value);
  }
  return parsed;
}

function requiredArgument(argumentsByName: Map<string, string>, name: string) {
  const value = argumentsByName.get(name);
  if (!value) throw new Error(`Falta --${name}.`);
  return value;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

import { resolve } from "node:path";
import { RenderInternals } from "@remotion/renderer";
import { generateVideoConformanceCorpusSource } from "./composition-video-corpus-generator";
import { NATIVE_CONFORMANCE_CORPUS_FPS } from "./composition-native-conformance-corpus";

async function main() {
  const values = process.argv.slice(2), args = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index], value = values[index + 1];
    if (!key || !["--output-parent", "--fps"].includes(key) || args.has(key) || !value || value.startsWith("--"))
      throw new Error("CONFORMANCE_CORPUS_ARGUMENTS_INVALID");
    args.set(key, value);
  }
  const parent = args.get("--output-parent"), fps = Number(args.get("--fps"));
  if (!parent || !NATIVE_CONFORMANCE_CORPUS_FPS.some((approved) => approved === fps)) throw new Error("CONFORMANCE_CORPUS_ARGUMENTS_INVALID");
  const binary = (type: "ffmpeg" | "ffprobe") => RenderInternals.getExecutablePath({binariesDirectory: null, indent: false, logLevel: "error", type});
  const result = await generateVideoConformanceCorpusSource({outputParentDirectory: resolve(parent), fps: fps as typeof NATIVE_CONFORMANCE_CORPUS_FPS[number],
    ffmpegPath: binary("ffmpeg"), ffprobePath: binary("ffprobe")});
  process.stdout.write(`${JSON.stringify({directory: result.directory, videoPath: result.videoPath, receiptPath: result.receiptPath,
    scope: result.receipt.scope, sourceSha256: result.receipt.source.checksum, recipeCount: result.receipt.cases.length})}\n`);
}
void main().catch((error: unknown) => {
  const code = error instanceof Error && /^CONFORMANCE_CORPUS_[A-Z_]+$/.test(error.message)
    ? error.message : "CONFORMANCE_CORPUS_GENERATION_FAILED";
  process.stderr.write(`${code}\n`); process.exitCode = 1;
});

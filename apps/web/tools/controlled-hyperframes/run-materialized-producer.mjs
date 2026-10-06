import {mkdir, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve, relative, isAbsolute, sep, join} from "node:path";
import {renderMaterializedProducer} from "./controlled-materialized-producer.mjs";
import {decodeMaterializedProducerRequest, materializedProducerOutputPaths, materializedProducerRequestDigest} from "./materialized-producer-request.mjs";

/** Must run inside the admitted owned process. This is not a standalone sandbox or collector. */
export async function runMaterializedProducer(encoded, ports = {}) {
  const request = decodeMaterializedProducerRequest(encoded);
  const output = materializedProducerOutputPaths(request);
  const suffix = relative(request.directory, output.directory);
  if (suffix === "" || !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`))
    throw new Error("CONTROLLED_RENDER_PRODUCER_OUTPUT_INVALID");
  const environment = ports.environment ?? process.env;
  const allowed = new Set(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]);
  for (const key of Object.keys(environment)) if (!allowed.has(key)) delete environment[key];
  Object.assign(environment, {NODE_ENV: "production", HYPERFRAMES_NO_TELEMETRY: "1",
    HYPERFRAMES_FFMPEG_PATH: request.encoderPath, HYPERFRAMES_FFPROBE_PATH: request.probePath,
    PRODUCER_HEADLESS_SHELL_PATH: request.browserPath, PRODUCER_VERIFY_HYPERFRAME_RUNTIME: "true"});
  try {
    const producer = ports.producer ?? await import("@hyperframes/producer");
    // Full defaults from the admitted SDK, not resolveConfig() with caller env fallbacks.
    if (!producer.DEFAULT_CONFIG || typeof producer.DEFAULT_CONFIG !== "object") throw new Error();
    await (ports.mkdir ?? mkdir)(output.directory, {recursive: false, mode: 0o700});
    const candidate = await renderMaterializedProducer({directory: request.directory,
      entryPath: join(request.directory, "index.html"), outputPath: output.videoPath, fps: request.fps,
      producerConfig: {...structuredClone(producer.DEFAULT_CONFIG), chromePath: request.browserPath},
      signal: new AbortController().signal}, {producer});
    const receipt = {version: 1, scope: "CANDIDATE_VIDEO_NOT_CONFORMANCE", requestSha256: materializedProducerRequestDigest(request),
      executionId: request.executionId, organizationId: request.organizationId, revisionId: request.revisionId,
      documentHash: request.documentHash, projectHash: request.projectHash, candidate};
    await (ports.writeFile ?? writeFile)(output.receiptPath, JSON.stringify(receipt), {flag: "wx", mode: 0o600});
    return receipt;
  } catch {throw new Error("CONTROLLED_RENDER_PRODUCER_PROCESS_FAILED");}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== "--operator-request") process.exitCode = 1;
  else await runMaterializedProducer(process.argv[3]).catch(() => {process.exitCode = 1;});
}

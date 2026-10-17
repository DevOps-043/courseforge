import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseFinalVideoGateArguments(values) {
  const allowed = new Set(["organization", "request", "contract", "preview-dir", "preview-metadata", "video", "output", "audio-policy", "audio-reference", "audio-reference-metadata"]);
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.slice(2);
    const value = values[index + 1];
    if (!values[index]?.startsWith("--") || !allowed.has(key) || key in options || !value || value.startsWith("--")) {
      throw new Error("FINAL_VIDEO_GATE_ARGUMENTS_INVALID");
    }
    options[key] = value;
  }
  for (const key of allowed) {
    if (!["audio-policy", "audio-reference", "audio-reference-metadata"].includes(key) && !options[key]) throw new Error("FINAL_VIDEO_GATE_ARGUMENTS_INVALID");
  }
  if (!UUID_PATTERN.test(options.organization) || !UUID_PATTERN.test(options.request)
    || (options["audio-policy"] && options["audio-policy"] !== "course-v1")
    || Boolean(options["audio-reference"]) !== Boolean(options["audio-reference-metadata"])) {
    throw new Error("FINAL_VIDEO_GATE_ARGUMENTS_INVALID");
  }
  return options;
}

function assertIntegrityResult(result) {
  if (!result || result.status !== "MATCH" || !UUID_PATTERN.test(result.assetId)
    || !SHA256_PATTERN.test(result.checksum) || !SHA256_PATTERN.test(result.documentHash)
    || !Number.isSafeInteger(result.sizeBytes) || result.sizeBytes <= 0 || result.sizeBytes > MAX_VIDEO_BYTES) {
    throw new Error("FINAL_VIDEO_GATE_INTEGRITY_INVALID");
  }
}

async function snapshotVideo(sourcePath, destinationPath, expected) {
  let sizeBytes = 0;
  const digest = createHash("sha256");
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      sizeBytes += chunk.length;
      if (sizeBytes > expected.sizeBytes) return callback(new Error("FINAL_VIDEO_GATE_LOCAL_SIZE_MISMATCH"));
      digest.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(createReadStream(resolve(sourcePath)), meter,
    createWriteStream(destinationPath, { flags: "wx", mode: 0o600 }));
  if (sizeBytes !== expected.sizeBytes || digest.digest("hex") !== expected.checksum) {
    throw new Error("FINAL_VIDEO_GATE_LOCAL_CONTENT_MISMATCH");
  }
}

/** Read-only remote gate. Dependencies are trusted adapters, never user-provided receipt files. */
export async function runFinalVideoGate(options, { checkIntegrity, compareVideo }) {
  const before = await checkIntegrity(options.organization, options.request);
  assertIntegrityResult(before);
  const directory = await mkdtemp(join(tmpdir(), "composition-final-gate-"));
  const videoPath = join(directory, "final.mp4");
  const receiptPath = join(directory, "receipt.json");
  try {
    await snapshotVideo(options.video, videoPath, before);
    await writeFile(receiptPath, JSON.stringify({ documentHash: before.documentHash, videoSha256: before.checksum }),
      { encoding: "utf8", flag: "wx", mode: 0o600 });
    const comparison = await compareVideo({
      audioReferencePath: options["audio-reference"],
      audioReferenceMetadataPath: options["audio-reference-metadata"],
      audioPolicyId: options["audio-policy"],
      contractPath: resolve(options.contract),
      previewDirectory: resolve(options["preview-dir"]),
      previewMetadataPath: resolve(options["preview-metadata"]),
      renderReceiptPath: receiptPath,
      videoPath,
    });
    if (!comparison || comparison.reportVersion !== 2 || !["PASS", "FAIL", "INCOMPLETE"].includes(comparison.status)
      || comparison.video?.sha256 !== before.checksum || comparison.video?.sizeBytes !== before.sizeBytes
      || comparison.documentHash !== before.documentHash
      || (options["audio-reference"] && (!comparison.audioTiming || comparison.audioTiming.status === "NOT_REQUESTED"
        || (comparison.status === "PASS" && comparison.audioTiming.rms?.status !== "PASS")))) {
      throw new Error("FINAL_VIDEO_GATE_REPORT_BINDING_INVALID");
    }
    const after = await checkIntegrity(options.organization, options.request);
    assertIntegrityResult(after);
    if (["assetId", "checksum", "documentHash", "sizeBytes"].some((key) => before[key] !== after[key])) {
      throw new Error("FINAL_VIDEO_GATE_REMOTE_CHANGED");
    }
    const report = {
      reportVersion: 1,
      scope: "REMOTE_INTEGRITY_AND_LOCAL_CONFORMANCE",
      status: comparison.status,
      organizationId: options.organization,
      requestId: options.request,
      integrity: {
        assetId: before.assetId, checksum: before.checksum, documentHash: before.documentHash, sizeBytes: before.sizeBytes,
        method: "STORAGE_RECHECK_BEFORE_AND_AFTER", checkedAt: new Date().toISOString(),
      },
      limitations: [comparison.audioTiming?.status === "PASS" ? "AUDIO_ENVELOPE_ONLY_NOT_CONTENT_IDENTITY" : "AUDIO_TIMING_NOT_VERIFIED",
        "NOT_A_SIGNED_ATTESTATION", "REMOTE_OBJECT_CAN_CHANGE_AFTER_CHECK"],
      comparison,
    };
    // Exclusive creation preserves earlier evidence and all input files on accidental path reuse.
    await writeFile(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return report;
  } finally {
    await rm(videoPath, { force: true });
    await rm(receiptPath, { force: true });
    await rmdir(directory);
  }
}

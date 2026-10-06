import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {lstat, open} from "node:fs/promises";
import {parseMaterializedProducerRequest, materializedProducerOutputPaths, materializedProducerRequestDigest} from "./materialized-producer-request.mjs";
import {MATERIALIZED_PRODUCER_POLICY} from "./controlled-materialized-producer.mjs";
import {auditMaterializedProducerCapture} from "./materialized-producer-capture-audit.mjs";
const appRequire = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
// Operational collector never loads a test build or falls back to one.
const compiled = "./dist/composition-worker/domains/production/composition-editor/qa/";
const {pinConformanceFile, assertConformanceFileUnchanged} = appRequire(`${compiled}composition-conformance-file-integrity.js`);
const {CONTROLLED_RENDER_STORAGE} = appRequire(`${compiled}composition-controlled-render-storage-policy.js`);
export const CANDIDATE_RECEIPT_MAXIMUM_BYTES = 8192;
const exactKeys = (value, fields) => value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(fields.slice().sort());

async function readBoundedReceipt(path) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(CANDIDATE_RECEIPT_MAXIMUM_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > CANDIDATE_RECEIPT_MAXIMUM_BYTES) throw new Error();
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(buffer.subarray(0, length)));
  } finally {await handle.close();}
}

/** Call only after the owned producer's confirmed closure. No receipt is a media measurement. */
export async function collectMaterializedProducerCandidate(rawRequest, signal) {
  const request = parseMaterializedProducerRequest(rawRequest), output = materializedProducerOutputPaths(request);
  try {
    signal.throwIfAborted();
    const directory = await lstat(output.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error();
    for (const path of [output.receiptPath, output.videoPath]) {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error();
    }
    const receiptPin = await pinConformanceFile(output.receiptPath, CANDIDATE_RECEIPT_MAXIMUM_BYTES);
    const receipt = await readBoundedReceipt(output.receiptPath);
    if (!exactKeys(receipt, ["version", "scope", "requestSha256", "executionId", "organizationId", "revisionId",
      "documentHash", "projectHash", "candidate"]) || receipt.version !== 1 || receipt.scope !== "CANDIDATE_VIDEO_NOT_CONFORMANCE"
      || receipt.requestSha256 !== materializedProducerRequestDigest(request)
      || ["executionId", "organizationId", "revisionId", "documentHash", "projectHash"].some(field => receipt[field] !== request[field])
      || !exactKeys(receipt.candidate, ["policy", "scope", "videoPath", "capture"])
      || receipt.candidate.policy !== MATERIALIZED_PRODUCER_POLICY.id || receipt.candidate.scope !== receipt.scope
      || receipt.candidate.videoPath !== output.videoPath) throw new Error();
    const capture = auditMaterializedProducerCapture(receipt.candidate.capture);
    if (!exactKeys(receipt.candidate.capture, Object.keys(capture)) || receipt.candidate.capture.scope !== capture.scope) throw new Error();
    await assertConformanceFileUnchanged(output.receiptPath, receiptPin, CANDIDATE_RECEIPT_MAXIMUM_BYTES);
    signal.throwIfAborted();
    const videoPin = await pinConformanceFile(output.videoPath, CONTROLLED_RENDER_STORAGE.maximumVideoBytes);
    signal.throwIfAborted();
    return {videoPath: output.videoPath, videoPin, receipt,
      assertUnchanged: async () => {
        signal.throwIfAborted();
        await assertConformanceFileUnchanged(output.receiptPath, receiptPin, CANDIDATE_RECEIPT_MAXIMUM_BYTES);
        await assertConformanceFileUnchanged(output.videoPath, videoPin, CONTROLLED_RENDER_STORAGE.maximumVideoBytes);
        signal.throwIfAborted();
      }};
  } catch {throw new Error("CONTROLLED_RENDER_PRODUCER_CANDIDATE_INVALID");}
}

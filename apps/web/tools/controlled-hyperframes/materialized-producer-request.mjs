import {isAbsolute, join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
export const MATERIALIZED_REQUEST_POLICY = Object.freeze({id: "OPERATOR_MATERIALIZED_PRODUCER_REQUEST_V1", maximumBytes: 4096});
const fields = ["policy", "executionId", "organizationId", "revisionId", "documentHash", "projectHash",
  "directory", "outputParentDirectory", "browserPath", "encoderPath", "probePath", "fps"].sort();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function parseMaterializedProducerRequest(raw) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(fields)
    || raw.policy !== MATERIALIZED_REQUEST_POLICY.id || ![24, 25, 30, 60].includes(raw.fps)
    || ["executionId", "organizationId", "revisionId"].some(key => typeof raw[key] !== "string" || !uuid.test(raw[key]))
    || ["documentHash", "projectHash"].some(key => typeof raw[key] !== "string" || !/^[a-f0-9]{64}$/.test(raw[key]))
    || ["directory", "outputParentDirectory", "browserPath", "encoderPath", "probePath"].some(key =>
      typeof raw[key] !== "string" || raw[key].length > 512 || raw[key].includes("\0") || !isAbsolute(raw[key]))
    || Buffer.byteLength(JSON.stringify(raw)) > MATERIALIZED_REQUEST_POLICY.maximumBytes)
    throw new Error("CONTROLLED_RENDER_PRODUCER_REQUEST_INVALID");
  return {...raw};
}
export function encodeMaterializedProducerRequest(raw) {
  return Buffer.from(JSON.stringify(parseMaterializedProducerRequest(raw)), "utf8").toString("base64");
}
export function decodeMaterializedProducerRequest(encoded) {
  try {
    if (typeof encoded !== "string" || encoded.length > 4 * Math.ceil(MATERIALIZED_REQUEST_POLICY.maximumBytes / 3)) throw new Error();
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) throw new Error();
    return parseMaterializedProducerRequest(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
  } catch {throw new Error("CONTROLLED_RENDER_PRODUCER_REQUEST_INVALID");}
}
export function materializedProducerOutputPaths(request) {
  const directory = join(request.outputParentDirectory, request.executionId);
  return {directory, videoPath: join(directory, "video.mp4"), receiptPath: join(directory, "candidate.json")};
}
export function materializedProducerRequestDigest(request) {
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(fields.map(field => [field, request[field]])))).digest("hex");
}

/** prepareLaunch port for the Windows bridge; accepts host descriptor, never a client request. */
export function prepareMaterializedProducerLaunch(descriptor, workspace, installation) {
  const {contract} = descriptor;
  if (contract?.schemaVersion !== 4 || !contract.renderExecution || contract.renderExecution.sdkVersion !== "0.7.106"
    || contract.renderExecution.sdrConversionPolicy || contract.renderExecution.sdrAudioMuxPolicy
    || contract.renderProfile?.quality !== "high" || contract.renderProfile.format !== "mp4"
    || contract.renderProfile.fps !== contract.canvas?.fps || contract.documentHash !== descriptor.documentHash
    || workspace.entryPath !== join(workspace.directory, "index.html")
    || workspace.receipt?.documentHash !== descriptor.documentHash || workspace.receipt?.projectHash !== descriptor.projectHash
    || workspace.receipt?.organizationId !== descriptor.organizationId || workspace.receipt?.revisionId !== descriptor.revisionId
    || typeof installation.nodePath !== "string" || !isAbsolute(installation.nodePath) || installation.nodePath.includes("\0"))
    throw new Error("CONTROLLED_RENDER_PRODUCER_PROFILE_UNSUPPORTED");
  const encoded = encodeMaterializedProducerRequest({policy: MATERIALIZED_REQUEST_POLICY.id,
    executionId: descriptor.executionId, organizationId: descriptor.organizationId, revisionId: descriptor.revisionId,
    documentHash: descriptor.documentHash, projectHash: descriptor.projectHash, directory: workspace.directory,
    outputParentDirectory: installation.outputParentDirectory, browserPath: installation.browserPath,
    encoderPath: installation.encoderPath, probePath: installation.probePath, fps: contract.canvas.fps});
  return {executable: installation.nodePath, directory: workspace.directory,
    arguments: [join(dirname(fileURLToPath(import.meta.url)), "run-materialized-producer.mjs"), "--operator-request", encoded]};
}

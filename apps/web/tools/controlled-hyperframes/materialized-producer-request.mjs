import {isAbsolute, join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {encodeObservedOperatorReference} from "./observed-producer-operator-reference.mjs";
import {MATERIALIZED_MEASUREMENT_PLAN_POLICY} from "./materialized-measurement-plan-policy.mjs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const compiled = "./dist/composition-worker/domains/production/composition-editor/";
const {compositionConformanceContractSchema} = require(`${compiled}composition-preview-render-conformance.js`);
const {SDR_FRAME_CONVERSION_POLICY, sdrFrameCaptureProfileSchema} = require(`${compiled}composition-sdr-conversion-policy.js`);
export const MATERIALIZED_REQUEST_POLICY = Object.freeze({id: "OPERATOR_MATERIALIZED_PRODUCER_REQUEST_V1", maximumBytes: 4096});
export const MATERIALIZED_OBSERVED_REQUEST_POLICY = "OPERATOR_OBSERVED_MATERIALIZED_PRODUCER_REQUEST_V2";
export const MATERIALIZED_MEASUREMENT_REQUEST_POLICY = "OPERATOR_OBSERVED_MEASUREMENT_PRODUCER_REQUEST_V3";
export const isObservedMaterializedRequest = request => [MATERIALIZED_OBSERVED_REQUEST_POLICY, MATERIALIZED_MEASUREMENT_REQUEST_POLICY].includes(request.policy);
const fields = ["policy", "executionId", "organizationId", "revisionId", "documentHash", "projectHash",
  "directory", "outputParentDirectory", "browserPath", "encoderPath", "probePath", "fps"].sort();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const requestFields = raw => raw.policy === MATERIALIZED_MEASUREMENT_REQUEST_POLICY
  ? [...fields, "renderExecutionSha256", "measurementPlanSha256", "measurementPlanSizeBytes"].sort()
  : isObservedMaterializedRequest(raw) ? [...fields, "renderExecutionSha256"].sort() : fields;
export function materializedExecutionDigest(execution) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return createHash("sha256").update(JSON.stringify(canonical(execution))).digest("hex");
}
export function parseMaterializedProducerRequest(raw) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(requestFields(raw))
    || ![MATERIALIZED_REQUEST_POLICY.id, MATERIALIZED_OBSERVED_REQUEST_POLICY, MATERIALIZED_MEASUREMENT_REQUEST_POLICY].includes(raw.policy)
    || isObservedMaterializedRequest(raw) && !/^[a-f0-9]{64}$/.test(raw.renderExecutionSha256 ?? "")
    || raw.policy === MATERIALIZED_MEASUREMENT_REQUEST_POLICY && (!/^[a-f0-9]{64}$/.test(raw.measurementPlanSha256 ?? "")
      || !Number.isSafeInteger(raw.measurementPlanSizeBytes) || raw.measurementPlanSizeBytes < 1
      || raw.measurementPlanSizeBytes > MATERIALIZED_MEASUREMENT_PLAN_POLICY.maximumBytes)
    || ![24, 25, 30, 60].includes(raw.fps)
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
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(requestFields(request).map(field => [field, request[field]])))).digest("hex");
}

/** prepareLaunch port for the Windows bridge; accepts host descriptor, never a client request. */
export function prepareMaterializedProducerLaunch(descriptor, workspace, installation) {
  const {contract} = descriptor;
  if (contract?.schemaVersion !== 4 || !contract.renderExecution || contract.renderExecution.sdkVersion !== "0.7.106"
    || contract.renderProfile?.quality !== "high" || contract.renderProfile.format !== "mp4"
    || contract.renderProfile.fps !== contract.canvas?.fps || contract.documentHash !== descriptor.documentHash
    || workspace.entryPath !== join(workspace.directory, "index.html")
    || workspace.receipt?.documentHash !== descriptor.documentHash || workspace.receipt?.projectHash !== descriptor.projectHash
    || workspace.receipt?.organizationId !== descriptor.organizationId || workspace.receipt?.revisionId !== descriptor.revisionId
    || typeof installation.nodePath !== "string" || !isAbsolute(installation.nodePath) || installation.nodePath.includes("\0"))
    throw new Error("CONTROLLED_RENDER_PRODUCER_PROFILE_UNSUPPORTED");
  const observed = Object.hasOwn(installation, "operatorConfiguration");
  const measured = observed && workspace.measurementPlanReference !== undefined;
  if (contract.renderExecution.sdrConversionPolicy || contract.renderExecution.sdrAudioMuxPolicy) {
    try {
      if (!measured) throw new Error();
      const parsed = compositionConformanceContractSchema.parse(contract);
      sdrFrameCaptureProfileSchema.parse({captureProfile: SDR_FRAME_CONVERSION_POLICY.captureProfile,
        width: parsed.canvas.width, height: parsed.canvas.height, fps: parsed.canvas.fps,
        frameCount: Math.ceil(parsed.canvas.durationSeconds * parsed.canvas.fps)});
    } catch {throw new Error("CONTROLLED_RENDER_PRODUCER_PROFILE_UNSUPPORTED");}
  }
  const encoded = encodeMaterializedProducerRequest({policy: measured ? MATERIALIZED_MEASUREMENT_REQUEST_POLICY
    : observed ? MATERIALIZED_OBSERVED_REQUEST_POLICY : MATERIALIZED_REQUEST_POLICY.id,
    executionId: descriptor.executionId, organizationId: descriptor.organizationId, revisionId: descriptor.revisionId,
    documentHash: descriptor.documentHash, projectHash: descriptor.projectHash, directory: workspace.directory,
    outputParentDirectory: installation.outputParentDirectory, browserPath: installation.browserPath,
    encoderPath: installation.encoderPath, probePath: installation.probePath, fps: contract.canvas.fps,
    ...(observed ? {renderExecutionSha256: materializedExecutionDigest(contract.renderExecution)} : {}),
    ...(measured ? {measurementPlanSha256: workspace.measurementPlanReference.sha256,
      measurementPlanSizeBytes: workspace.measurementPlanReference.sizeBytes} : {})});
  const operatorArguments = observed ? ["--operator-configuration", encodeObservedOperatorReference(installation.operatorConfiguration)] : [];
  return {executable: installation.nodePath, directory: workspace.directory,
    arguments: [join(dirname(fileURLToPath(import.meta.url)), observed ? "run-observed-materialized-producer.mjs" : "run-materialized-producer.mjs"),
      "--operator-request", encoded, ...operatorArguments]};
}

import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {MATERIALIZED_MEASUREMENT_PLAN_POLICY} from "./materialized-measurement-plan-policy.mjs";
import {materializedProducerRequestDigest, materializedExecutionDigest} from "./materialized-producer-request.mjs";
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const compiled = "./dist/composition-worker/domains/production/composition-editor/";
const {bindControlledRendererNativeEvidence} = require(`${compiled}qa/composition-controlled-native-binding.js`);
const {bindControlledEventNativeEvidence} = require(`${compiled}qa/composition-controlled-event-native-binding.js`);
const {bindControlledSeekRepeatability} = require(`${compiled}qa/composition-controlled-seek-binding.js`);
const {prepareCompositionEventBatchContracts} = require(`${compiled}composition-conformance-event-batch-contract.js`);
const {bindOriginalExecutionObservation} = require(`${compiled}qa/composition-original-execution-binding.js`);
const {compositionConformanceContractSchema} = require(`${compiled}composition-preview-render-conformance.js`);
export const ORIGINAL_NATIVE_RECEIPT_FILE = "original-native.json";
export const ORIGINAL_NATIVE_RECEIPT_MAXIMUM_BYTES = MATERIALIZED_MEASUREMENT_PLAN_POLICY.maximumBytes;
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.slice().sort());

export function validateOriginalNativeReceipt(raw, {request, videoPin, contract: input, document}) {
  const contract = compositionConformanceContractSchema.parse(input);
  const events = contract.schemaVersion === 4 && !!contract.checkpointBatch;
  const seek = contract.schemaVersion === 4 && !!contract.renderExecution?.seekRepeatabilityPolicy;
  if (contract.schemaVersion !== 4 || contract.documentHash !== request.documentHash
    || materializedExecutionDigest(contract.renderExecution) !== request.renderExecutionSha256
    || !exact(raw, ["version", "scope", "requestSha256", "measurementPlanSha256", "documentHash", "projectHash", "executionId", "video", "nativeEvidence", "renderExecutionObservation",
      ...(events ? ["eventNativeEvidence"] : []), ...(seek ? ["seekRepeatability", ...(events ? ["eventSeekRepeatability"] : [])] : [])])
    || raw.version !== 1 || raw.scope !== "CANDIDATE_ORIGINAL_NATIVE_NOT_SUPERVISOR_ARTIFACT"
    || raw.requestSha256 !== materializedProducerRequestDigest(request)
    || ["measurementPlanSha256", "documentHash", "projectHash", "executionId"].some(key => raw[key] !== request[key])
    || !exact(raw.video, ["sha256", "sizeBytes"]) || raw.video.sha256 !== videoPin.sha256 || raw.video.sizeBytes !== videoPin.sizeBytes) throw new Error();
  const requiresFonts = !!contract.fontUsageContract?.bindings.length;
  const native = raw.nativeEvidence;
  if (!exact(native, ["scope", "textEvidence", ...(requiresFonts ? ["fontEvidence"] : [])])
    || native.scope !== "SDK_SESSION_NATIVE_TEXT_AND_CUSTOM_GLYPHS_NOT_PREVIEW_PARITY") throw new Error();
  const bound = bindControlledRendererNativeEvidence(contract, native, videoPin.sha256);
  const eventNativeEvidence = events ? bindControlledEventNativeEvidence({document, parentContract: contract,
    videoSha256: videoPin.sha256, evidence: raw.eventNativeEvidence}) : undefined;
  if (events && JSON.stringify(eventNativeEvidence.batches[0].nativeEvidence) !== JSON.stringify(bound.nativeEvidence)) throw new Error();
  const seekRepeatability = seek ? bindControlledSeekRepeatability(contract, raw.seekRepeatability) : undefined;
  if (seek && !seekRepeatability) throw new Error();
  let eventSeekRepeatability;
  if (seek && events) {
    const prepared = prepareCompositionEventBatchContracts({document, parentContract: contract});
    if (!Array.isArray(raw.eventSeekRepeatability) || raw.eventSeekRepeatability.length !== prepared.batchCount) throw new Error();
    eventSeekRepeatability = raw.eventSeekRepeatability.map((report, index) => {
      const bound = bindControlledSeekRepeatability(prepared.select(index).contract, report);
      if (!bound) throw new Error();
      return bound;
    });
    if (JSON.stringify(eventSeekRepeatability[0]) !== JSON.stringify(seekRepeatability)) throw new Error();
  }
  const renderExecutionObservation = bindOriginalExecutionObservation({expected: contract.renderExecution,
    documentHash: request.documentHash, videoSha256: videoPin.sha256, observation: raw.renderExecutionObservation});
  return {...raw, renderExecutionObservation, nativeEvidence: bound.nativeEvidence, ...(events ? {eventNativeEvidence} : {}),
    ...(seek ? {seekRepeatability, ...(events ? {eventSeekRepeatability} : {})} : {})};
}

import {writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {join, resolve} from "node:path";
import {runMaterializedProducer} from "./run-materialized-producer.mjs";
import {decodeMaterializedProducerRequest, materializedProducerOutputPaths,
  isObservedMaterializedRequest, MATERIALIZED_MEASUREMENT_REQUEST_POLICY, materializedExecutionDigest} from "./materialized-producer-request.mjs";
import {readMaterializedMeasurementPlan} from "./materialized-measurement-plan.mjs";
import {createOriginalSessionNativeObserver} from "./original-session-native-observer.mjs";
import {createOriginalSessionSdrStages, ORIGINAL_SDR_STAGE_TIMEOUT_MILLISECONDS} from "./original-session-sdr-stages.mjs";
import {ORIGINAL_NATIVE_RECEIPT_FILE, ORIGINAL_NATIVE_RECEIPT_MAXIMUM_BYTES} from "./original-native-receipt.mjs";
import {readObservedOperatorConfiguration} from "./observed-producer-operator-configuration.mjs";
import {decodeObservedOperatorReference} from "./observed-producer-operator-reference.mjs";
import {createOriginalSessionObserver} from "./original-session-observer.mjs";
import {startOriginalSessionNetworkGuard} from "./original-session-network-guard.mjs";
import {createRequire} from "node:module";
import {dirname} from "node:path";
import {ORIGINAL_SESSION_RECEIPT_FILE} from "./original-session-receipt.mjs";
const appRequire = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const compiled = "./dist/composition-worker/domains/production/composition-editor/qa/";
const {pinConformanceFile, assertConformanceFileUnchanged} = appRequire(`${compiled}composition-conformance-file-integrity.js`);
const {CONTROLLED_RENDER_STORAGE} = appRequire(`${compiled}composition-controlled-render-storage-policy.js`);
const {buildOriginalExecutionObservation} = appRequire(`${compiled}composition-original-execution-binding.js`);

/** Fixed process entry: no module path, callback source or policy override from the job. */
export async function runObservedMaterializedProducer(encodedRequest, encodedReference, ports = {}) {
  let native;
  const networkGuards = new Map();
  const checkNetwork = async () => {for (const guard of networkGuards.values()) await guard.assertHealthy();};
  try {
    const request = decodeMaterializedProducerRequest(encodedRequest);
    const signal = ports.signal ?? new AbortController().signal;
    const operator = await readObservedOperatorConfiguration(decodeObservedOperatorReference(encodedReference), signal);
    if (!isObservedMaterializedRequest(request)
      || request.renderExecutionSha256 !== materializedExecutionDigest(operator.configuration.execution)) throw new Error();
    const measurement = request.policy === MATERIALIZED_MEASUREMENT_REQUEST_POLICY
      ? await readMaterializedMeasurementPlan(request, signal) : undefined;
    const recorder = createOriginalSessionObserver({expectedBrowser: operator.configuration.execution.expectedBrowser, signal});
    native = measurement ? createOriginalSessionNativeObserver({...measurement,
      outputDirectory: materializedProducerOutputPaths(request).directory}, signal) : undefined;
    const sdrStages = measurement?.plan.contract.renderExecution?.sdrConversionPolicy
      ? createOriginalSessionSdrStages({contract: measurement.plan.contract, signal,
        outputDirectory: materializedProducerOutputPaths(request).directory,
        videoPath: materializedProducerOutputPaths(request).videoPath, encoderPath: request.encoderPath, probePath: request.probePath,
        timeoutMilliseconds: ORIGINAL_SDR_STAGE_TIMEOUT_MILLISECONDS,
        acquireFrames: () => native.finalizeFrames(), verifyFiles: async () => {
          await operator.assertUnchanged(); await measurement.assertUnchanged();
        }}, ports.sdrStagePorts ?? {}) : undefined;
    const observer = Object.fromEntries(["onSession", "onBeforeFrame", "onAfterFrame"].map(method => [method, async payload => {
      if (method === "onSession") {
        if (networkGuards.has(payload.session)) throw new Error("CONTROLLED_RENDER_ORIGINAL_NETWORK_REJECTED");
        networkGuards.set(payload.session, await startOriginalSessionNetworkGuard({cdp: payload.cdp,
          serverUrl: payload.session.serverUrl, signal}));
      }
      await checkNetwork();
      await recorder.observer[method](payload);
      await native?.observer[method](payload);
      await checkNetwork();
    }]));
    if (sdrStages) Object.assign(observer, {onEncode: sdrStages.onEncode, onAfterAssemble: sdrStages.onAfterAssemble});
    await operator.assertUnchanged();
    await measurement?.assertUnchanged();
    const receipt = await runMaterializedProducer(encodedRequest, {...ports, signal,
      observedInstallation: {...operator.configuration, observer}});
    await checkNetwork();
    const observations = recorder.finalize();
    const nativeEvidence = native?.finalize();
    const eventNativeEvidence = native?.finalizeEvents();
    const seekEvidence = native?.finalizeSeek();
    const frames = await native?.finalizeFrames();
    const sdrResults = await sdrStages?.finalize();
    await frames?.assertUnchanged();
    await measurement?.assertUnchanged();
    await operator.assertUnchanged();
    const output = materializedProducerOutputPaths(request);
    const videoPin = await pinConformanceFile(output.videoPath, CONTROLLED_RENDER_STORAGE.maximumVideoBytes, true);
    let nativePin;
    if (nativeEvidence) {
      const renderExecutionObservation = buildOriginalExecutionObservation({expected: measurement.plan.contract.renderExecution,
        documentHash: request.documentHash, videoSha256: videoPin.sha256, fileObservations: receipt.fileObservations,
        browserBefore: observations.browserBefore, browserAfter: observations.browserAfter, ...(sdrResults ?? {})});
      const bytes = JSON.stringify({version: 1, scope: "CANDIDATE_ORIGINAL_NATIVE_NOT_SUPERVISOR_ARTIFACT",
        requestSha256: receipt.requestSha256, measurementPlanSha256: request.measurementPlanSha256,
        documentHash: request.documentHash, projectHash: request.projectHash, executionId: request.executionId,
        video: {sha256: videoPin.sha256, sizeBytes: videoPin.sizeBytes}, nativeEvidence,
        renderExecutionObservation, ...(eventNativeEvidence ? {eventNativeEvidence} : {}), ...(seekEvidence ?? {})});
      if (Buffer.byteLength(bytes) > ORIGINAL_NATIVE_RECEIPT_MAXIMUM_BYTES) throw new Error();
      await writeFile(join(output.directory, ORIGINAL_NATIVE_RECEIPT_FILE), bytes, {flag: "wx", mode: 0o600});
      nativePin = await pinConformanceFile(join(output.directory, ORIGINAL_NATIVE_RECEIPT_FILE), ORIGINAL_NATIVE_RECEIPT_MAXIMUM_BYTES, false, signal);
      if (nativePin.sha256 !== createHash("sha256").update(bytes).digest("hex")) throw new Error();
    }
    await (ports.writeObservation ?? writeFile)(join(output.directory, ORIGINAL_SESSION_RECEIPT_FILE), JSON.stringify({version: 1,
      scope: "CANDIDATE_ORIGINAL_SESSION_NOT_SUPERVISOR_ARTIFACT", requestSha256: receipt.requestSha256,
      executionId: receipt.executionId, documentHash: receipt.documentHash, projectHash: receipt.projectHash,
      video: {sha256: videoPin.sha256, sizeBytes: videoPin.sizeBytes}, observations}),
    {flag: "wx", mode: 0o600});
    await operator.assertUnchanged();
    await measurement?.assertUnchanged();
    await frames?.assertUnchanged();
    if (nativePin) await assertConformanceFileUnchanged(join(output.directory, ORIGINAL_NATIVE_RECEIPT_FILE), nativePin,
      ORIGINAL_NATIVE_RECEIPT_MAXIMUM_BYTES, false, signal);
    await assertConformanceFileUnchanged(output.videoPath, videoPin, CONTROLLED_RENDER_STORAGE.maximumVideoBytes, true);
    signal.throwIfAborted();
    await checkNetwork();
    return receipt;
  } catch {throw new Error("CONTROLLED_RENDER_OBSERVED_PROCESS_FAILED");}
  finally {
    try {
      const healthy = await Promise.all([...networkGuards.values()].map(guard => guard.close()));
      if (healthy.some(value => !value)) throw new Error("CONTROLLED_RENDER_ORIGINAL_NETWORK_REJECTED");
    }
    catch {throw new Error("CONTROLLED_RENDER_OBSERVED_PROCESS_FAILED");}
    finally {try {native?.close();} catch {throw new Error("CONTROLLED_RENDER_OBSERVED_PROCESS_FAILED");}}
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 6 || process.argv[2] !== "--operator-request" || process.argv[4] !== "--operator-configuration") process.exitCode = 1;
  else await runObservedMaterializedProducer(process.argv[3], process.argv[5]).catch(() => {process.exitCode = 1;});
}

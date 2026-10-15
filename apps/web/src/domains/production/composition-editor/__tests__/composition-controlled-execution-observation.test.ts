import assert from "node:assert/strict";
import test from "node:test";
import {buildControlledExecutionObservation} from "../qa/composition-controlled-execution-observation";
import {buildOriginalExecutionObservation, bindOriginalExecutionObservation} from "../qa/composition-original-execution-binding";
import {controlledRenderExecutionContractSchema, evaluateControlledRenderExecution} from "../composition-render-execution-contract";
import {SDR_AUDIO_MUX_POLICY, SDR_SILENT_ASSEMBLY_POLICY, SDR_FRAME_CONVERSION_POLICY} from "../composition-sdr-conversion-policy";

const hash = (character: string) => character.repeat(64);
const file = {sha256: hash("a"), sizeBytes: 10};
const browser = {protocolVersion: "1.3", product: "Chrome/test", revision: "test", userAgent: "test", jsVersion: "test"};
test("silent remux result binds converted input to different final bytes without declaring audio mux", () => {
  const state = fixture(false);
  state.sdrEncoding!.output.sha256 = hash("d");
  const sdrSilentAssembly = {policy: SDR_SILENT_ASSEMBLY_POLICY,
    scope: "LOCAL_PROBED_SILENT_VIDEO_COPY_NOT_RENDER_ATTESTATION", silentVideoSha256: hash("d"),
    videoSha256: state.observation.videoSha256, probeSha256: file.sha256, videoPayloadSha256: hash("e"), videoTimingSha256: hash("f")};
  const observed = buildControlledExecutionObservation({...state, sdrSilentAssembly});
  assert.deepEqual(buildOriginalExecutionObservation({expected: state.expected, documentHash: state.observation.documentHash,
    videoSha256: state.observation.videoSha256, browserBefore: browser, browserAfter: browser,
    fileObservations: {scope: "DECLARED_TREES_NOT_OS_IMAGE_OR_DYNAMIC_DEPENDENCY_PROOF", files: state.observation.files,
      comparisonTools: state.observation.comparisonTools}, sdrEncoding: state.sdrEncoding, sdrSilentAssembly}), observed);
  assert.equal(observed.sdrConversionPolicy, SDR_FRAME_CONVERSION_POLICY.id);
  assert.equal(observed.sdrAudioMuxPolicy, undefined);
  assert.throws(() => buildControlledExecutionObservation(state), /SDR_OUTPUT_INVALID/);
  for (const patch of [{videoSha256: hash("9")}, {silentVideoSha256: hash("9")}, {probeSha256: hash("9")},
    {videoPayloadSha256: undefined}, {videoTimingSha256: undefined}, {scope: "ATTESTED"}])
    assert.throws(() => buildControlledExecutionObservation({...state, sdrSilentAssembly: {...sdrSilentAssembly, ...patch}}), /ASSEMBLY_BINDING_INVALID/);
  assert.throws(() => buildControlledExecutionObservation({...fixture(), sdrSilentAssembly}), /ASSEMBLY_UNAUTHORIZED/);
  assert.throws(() => buildControlledExecutionObservation({...fixture(false, false), sdrSilentAssembly}), /SDR_UNAUTHORIZED/);
});
test("original execution binds successful SDR/mux results and rejects a foreign final video", () => {
  const state = fixture();
  const input = {expected: state.expected, documentHash: state.observation.documentHash, videoSha256: state.observation.videoSha256,
    browserBefore: browser, browserAfter: browser,
    fileObservations: {scope: "DECLARED_TREES_NOT_OS_IMAGE_OR_DYNAMIC_DEPENDENCY_PROOF", files: state.observation.files,
      comparisonTools: state.observation.comparisonTools}, sdrEncoding: state.sdrEncoding, sdrMux: state.sdrMux};
  assert.equal(buildOriginalExecutionObservation(input).sdrAudioMuxPolicy, SDR_AUDIO_MUX_POLICY);
  assert.throws(() => buildOriginalExecutionObservation({...input, videoSha256: hash("9")}), /MUX_BINDING_INVALID/);
  assert.throws(() => buildOriginalExecutionObservation({...input, sdrEncoding: undefined}), /SDR_RESULTS_REQUIRED/);
});
function fixture(mux = true, sdr = true) {
  const expected = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend: "CONTROLLED", sdkVersion: "0.7.106", expectedBrowser: browser,
    files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"].map(role => [role, file])),
    comparisonTools: {policy: "EXPLICIT_PIXEL_DECODER_AND_PROBE_V1", pixelDecoder: file, probe: file},
    ...(sdr ? {sdrConversionPolicy: SDR_FRAME_CONVERSION_POLICY.id} : {}),
    ...(sdr && mux ? {sdrAudioMuxPolicy: SDR_AUDIO_MUX_POLICY} : {})});
  const observation = {policy: expected.policy, documentHash: hash("b"), videoSha256: hash("c"),
    files: structuredClone(expected.files), comparisonTools: structuredClone(expected.comparisonTools),
    browserBefore: {...browser}, browserAfter: {...browser}};
  const sdrEncoding = {policy: SDR_FRAME_CONVERSION_POLICY, encoderSha256: file.sha256,
    probeSha256: file.sha256, output: {sha256: mux ? hash("d") : observation.videoSha256}};
  const sdrMux = {policy: SDR_AUDIO_MUX_POLICY, scope: "LOCAL_PROBED_VIDEO_PAYLOADS_NOT_SYNC_OR_RENDER_ATTESTATION",
    silentVideoSha256: sdrEncoding.output.sha256, videoSha256: observation.videoSha256,
    probeSha256: file.sha256, videoPayloadSha256: hash("e"), videoTimingSha256: hash("f")};
  return {expected, observation, ...(sdr ? {sdrEncoding} : {}), ...(sdr && mux ? {sdrMux} : {})};
}

test("original file/session observation assembles measured bindings without promoting renderer authority", () => {
  const {expected, observation} = fixture(false, false);
  const measured = {scope: "DECLARED_TREES_NOT_OS_IMAGE_OR_DYNAMIC_DEPENDENCY_PROOF",
    files: structuredClone(observation.files), comparisonTools: structuredClone(observation.comparisonTools)};
  const observed = buildOriginalExecutionObservation({expected, documentHash: observation.documentHash,
    videoSha256: observation.videoSha256, fileObservations: measured, browserBefore: browser, browserAfter: browser});
  assert.deepEqual(observed, observation);
  assert.equal(evaluateControlledRenderExecution({expected, documentHash: observed.documentHash,
    videoSha256: observed.videoSha256, observation: observed}).reason, "RENDER_EXECUTION_ATTESTATION_PENDING");
  observed.files.node.sha256 = hash("e");
  assert.equal(measured.files.node.sha256, file.sha256);
});

test("missing observed roles, wrong CDP and changed comparison binaries cannot copy expected identity", () => {
  const {expected, observation} = fixture(false, false);
  const base = {expected, documentHash: observation.documentHash, videoSha256: observation.videoSha256,
    browserBefore: browser, browserAfter: browser,
    fileObservations: {scope: "DECLARED_TREES_NOT_OS_IMAGE_OR_DYNAMIC_DEPENDENCY_PROOF",
      files: observation.files, comparisonTools: observation.comparisonTools}};
  assert.throws(() => buildOriginalExecutionObservation({...base, fileObservations: undefined}));
  assert.throws(() => buildOriginalExecutionObservation({...base, browserAfter: {...browser, product: "foreign"}}), /BINDING_INVALID/);
  assert.throws(() => buildOriginalExecutionObservation({...base, fileObservations: {...base.fileObservations, comparisonTools: undefined}}), /BINDING_INVALID/);
  assert.throws(() => buildOriginalExecutionObservation({...base, fileObservations: {...base.fileObservations,
    files: {...observation.files, engine: {...file, sha256: hash("e")}}}}), /BINDING_INVALID/);
});

test("original execution binding rejects output substitutions and conflicting independently supplied observations", () => {
  const {expected, observation} = fixture(false, false);
  const base = {expected, documentHash: observation.documentHash, videoSha256: observation.videoSha256, observation};
  assert.throws(() => bindOriginalExecutionObservation({...base, videoSha256: hash("e")}), /BINDING_INVALID/);
  assert.throws(() => bindOriginalExecutionObservation({...base, documentHash: hash("e")}), /BINDING_INVALID/);
  assert.throws(() => bindOriginalExecutionObservation({...base,
    supplied: {...observation, files: {...observation.files, node: {...file, sizeBytes: 20}}}}), /CONFLICT/);
});

test("original file/CDP observation cannot declare SDR conversion or mux from an expected policy", () => {
  const {expected, observation} = fixture();
  assert.throws(() => buildOriginalExecutionObservation({expected, documentHash: observation.documentHash,
    videoSha256: observation.videoSha256, fileObservations: {scope: "DECLARED_TREES_NOT_OS_IMAGE_OR_DYNAMIC_DEPENDENCY_PROOF",
      files: observation.files, comparisonTools: observation.comparisonTools}, browserBefore: browser, browserAfter: browser}), /SDR_RESULTS_REQUIRED/);
});

test("SDR mux observation reaches the execution consumer with both required policies", () => {
  const input = fixture();
  const observed = buildControlledExecutionObservation(input);
  assert.equal(observed.sdrConversionPolicy, SDR_FRAME_CONVERSION_POLICY.id);
  assert.equal(observed.sdrAudioMuxPolicy, SDR_AUDIO_MUX_POLICY);
  assert.equal(evaluateControlledRenderExecution({...input, documentHash: observed.documentHash,
    videoSha256: observed.videoSha256, observation: observed}).status, "MATCH");
  assert.equal("sdrAudioMuxPolicy" in input.observation, false);
  observed.files.encoder.sizeBytes++;
  assert.equal(input.observation.files.encoder.sizeBytes, 10);
});
test("non-SDR and SDR video-only retain their distinct obligations", () => {
  const legacy = buildControlledExecutionObservation(fixture(false, false));
  assert.equal(legacy.sdrConversionPolicy, undefined);
  assert.equal(legacy.sdrAudioMuxPolicy, undefined);
  const videoOnly = buildControlledExecutionObservation(fixture(false));
  assert.equal(videoOnly.sdrConversionPolicy, SDR_FRAME_CONVERSION_POLICY.id);
  assert.equal(videoOnly.sdrAudioMuxPolicy, undefined);
});
test("missing or foreign encoder/mux results cannot manufacture a policy declaration", () => {
  const input = fixture();
  for (const field of ["encoderSha256", "probeSha256"] as const)
    assert.throws(() => buildControlledExecutionObservation({...input,
      sdrEncoding: {...input.sdrEncoding!, [field]: hash("f")}}), /SDR_BINDING_INVALID/);
  assert.throws(() => buildControlledExecutionObservation({...input, sdrEncoding: undefined}), /SDR_BINDING_INVALID/);
  assert.throws(() => buildControlledExecutionObservation({...input, sdrMux: undefined}), /MUX_BINDING_INVALID/);
  for (const field of ["silentVideoSha256", "videoSha256", "probeSha256"] as const)
    assert.throws(() => buildControlledExecutionObservation({...input,
      sdrMux: {...input.sdrMux!, [field]: hash("f")}}), /MUX_BINDING_INVALID/);
  for (const field of ["videoPayloadSha256", "videoTimingSha256"] as const)
    assert.throws(() => buildControlledExecutionObservation({...input,
      sdrMux: {...input.sdrMux!, [field]: undefined}}), /MUX_BINDING_INVALID/);
});
test("unexpected SDR results, predeclared policies and changed observed tools fail closed", () => {
  const input = fixture();
  assert.throws(() => buildControlledExecutionObservation({...fixture(false, false), sdrMux: input.sdrMux}), /SDR_UNAUTHORIZED/);
  assert.throws(() => buildControlledExecutionObservation({...fixture(false), sdrMux: input.sdrMux}), /SDR_OUTPUT_INVALID/);
  assert.throws(() => buildControlledExecutionObservation({...input,
    observation: {...input.observation, sdrAudioMuxPolicy: SDR_AUDIO_MUX_POLICY}}), /POLICY_PREDECLARED/);
  const changed = fixture(); changed.observation.files.encoder.sha256 = hash("e");
  assert.throws(() => buildControlledExecutionObservation(changed), /EXECUTION_MISMATCH/);
  const only = fixture(false); only.sdrEncoding!.output.sha256 = hash("e");
  assert.throws(() => buildControlledExecutionObservation(only), /SDR_OUTPUT_INVALID/);
});

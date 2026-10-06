import assert from "node:assert/strict";
import test from "node:test";
import {buildControlledExecutionObservation} from "../qa/composition-controlled-execution-observation";
import {controlledRenderExecutionContractSchema, evaluateControlledRenderExecution} from "../composition-render-execution-contract";
import {SDR_AUDIO_MUX_POLICY, SDR_FRAME_CONVERSION_POLICY} from "../composition-sdr-conversion-policy";

const hash = (character: string) => character.repeat(64);
const file = {sha256: hash("a"), sizeBytes: 10};
const browser = {protocolVersion: "1.3", product: "Chrome/test", revision: "test", userAgent: "test", jsVersion: "test"};
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

import assert from "node:assert/strict";
import test from "node:test";
import {SDR_FRAME_CONVERSION_POLICY, SDR_AUDIO_MUX_POLICY} from "../composition-sdr-conversion-policy";
import {controlledRenderExecutionContractSchema, evaluateControlledRenderExecution} from "../composition-render-execution-contract";
import {resolveSdrCheckpointFilter, assertSdrCheckpointStreamProfile} from "../qa/composition-sdr-checkpoint-decoder";
import {buildSnapshotConformanceContract} from "../composition-snapshot-conformance-contract";
import {createTransitionDocument} from "./composition-transition-test-fixtures";
import {compositionConformanceContractSchema, evaluateCompositionConformance} from "../composition-preview-render-conformance";
import {buildControlledComparisonArtifacts} from "../qa/composition-controlled-comparison-artifacts";
import {assertSnapshotVisibilityReuse} from "../composition-snapshot-conformance-policy";
import {exportedVideoReceiptSchema} from "../qa/composition-exported-video-conformance";

const documentHash = "a".repeat(64), videoSha256 = "b".repeat(64), file = {sha256: "c".repeat(64), sizeBytes: 10};
const browser = {protocolVersion: "1.3", product: "Chrome/test", revision: "revision", userAgent: "test", jsVersion: "test"};
const legacy = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
  backend: "CONTROLLED", sdkVersion: "0.7.106", expectedBrowser: browser,
  files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"].map(role => [role, file]))});
const expected = controlledRenderExecutionContractSchema.parse({...legacy,
  sdrConversionPolicy: SDR_FRAME_CONVERSION_POLICY.id,
  comparisonTools: {policy: "EXPLICIT_PIXEL_DECODER_AND_PROBE_V1", pixelDecoder: file, probe: file}});
function observation(sdr = true) {return {policy: legacy.policy, documentHash, videoSha256,
  files: legacy.files, browserBefore: browser, browserAfter: browser,
  ...(sdr ? {comparisonTools: expected.comparisonTools, sdrConversionPolicy: SDR_FRAME_CONVERSION_POLICY.id} : {})};}
function contract() {return buildSnapshotConformanceContract({document: createTransitionDocument(), documentHash, assets: [],
  contractVersion: 4, colorTags: true, renderExecution: expected,
  renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});}

test("legacy contracts and receipts never select a new inverse from tags alone", () => {
  assert.equal(resolveSdrCheckpointFilter({documentHash, videoSha256}), undefined);
  assert.equal(resolveSdrCheckpointFilter({expected: legacy, observation: observation(false), documentHash, videoSha256}), undefined);
  assert.deepEqual(exportedVideoReceiptSchema.parse({documentHash, videoSha256}), {documentHash, videoSha256});
});

test("the declared fixed pair is selected only by matching frozen execution and receipt", () => {
  const filter = resolveSdrCheckpointFilter({expected, observation: observation(), documentHash, videoSha256});
  assert.equal(filter, SDR_FRAME_CONVERSION_POLICY.compareFilter);
  assert.ok(filter?.includes("transferin=709"));
  assert.ok(filter?.includes("transfer=iec61966-2-1"));
  assert.ok(SDR_FRAME_CONVERSION_POLICY.encodeFilter.includes("transferin=iec61966-2-1"));
  assert.ok(SDR_FRAME_CONVERSION_POLICY.encodeFilter.includes("transfer=709"));
});

test("missing, foreign, changed tools/browser or unauthorized policy blocks inverse selection", () => {
  const base = {expected, observation: observation(), documentHash, videoSha256};
  for (const patch of [{observation: undefined}, {observation: observation(false)}, {documentHash: videoSha256},
    {videoSha256: documentHash}, {observation: {...observation(), browserAfter: {...browser, revision: "changed"}}},
    {observation: {...observation(), comparisonTools: {...expected.comparisonTools, pixelDecoder: {...file, sizeBytes: 11}}}},
    {observation: {...observation(), sdrConversionPolicy: "GUESS_FROM_TAGS"}}])
    assert.throws(() => resolveSdrCheckpointFilter({...base, ...patch}), String(patch));
  assert.throws(() => resolveSdrCheckpointFilter({...base, expected: legacy}), /UNAUTHORIZED/);
});

test("new conversion requires explicit comparison tools and color policy, and rejects arbitrary filters", () => {
  assert.equal(controlledRenderExecutionContractSchema.safeParse({...legacy, sdrConversionPolicy: SDR_FRAME_CONVERSION_POLICY.id}).success, false);
  assert.equal(controlledRenderExecutionContractSchema.safeParse({...expected, customFilter: "arbitrary"}).success, false);
  const frozen = contract();
  assert.equal(compositionConformanceContractSchema.safeParse({...frozen, colorTagPolicy: undefined}).success, false);
});

test("snapshot reuse and exported artifacts preserve the conversion obligation, without promoting attestation", () => {
  const frozen = contract(), artifacts = buildControlledComparisonArtifacts({contract: frozen,
    observation: observation(), documentHash, videoSha256});
  assert.equal(artifacts.receipt.renderExecution?.sdrConversionPolicy, SDR_FRAME_CONVERSION_POLICY.id);
  const withoutConversion = compositionConformanceContractSchema.parse({...frozen,
    renderExecution: {...expected, sdrConversionPolicy: undefined}});
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: withoutConversion}, frozen), /RENDER_EXECUTION_MISMATCH/);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: frozen}, withoutConversion), /RENDER_EXECUTION_MISMATCH/);
  const execution = evaluateControlledRenderExecution({expected, documentHash, videoSha256,
    observation: {...observation(), sdrConversionPolicy: undefined}});
  assert.deepEqual(execution.mismatches, ["SDR_CONVERSION"]);
  assert.throws(() => buildControlledComparisonArtifacts({contract: frozen, observation: observation(false), documentHash, videoSha256}), /MISMATCH/);
  const visual = evaluateCompositionConformance({contract: frozen, previewDocumentHash: documentHash, renderDocumentHash: documentHash, samples: []});
  assert.equal(visual.status, "INCOMPLETE");
  assert.ok(visual.incompletenessReasons?.includes("SDR_PIXEL_CONVERSION_UNATTESTED"));
  assert.ok(visual.incompletenessReasons?.includes("RENDER_EXECUTION_ATTESTATION_PENDING"));
});

const stream = {codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", color_space: "bt709",
  color_primaries: "bt709", color_transfer: "bt709", color_range: "tv", chroma_location: "left"};
test("audio mux is a separate frozen obligation; legacy video-only policy never accepts extra audio", () => {
  const required = controlledRenderExecutionContractSchema.parse({...expected, sdrAudioMuxPolicy: SDR_AUDIO_MUX_POLICY});
  const observed = {...observation(), sdrAudioMuxPolicy: SDR_AUDIO_MUX_POLICY};
  assert.equal(resolveSdrCheckpointFilter({expected: required, observation: observed, documentHash, videoSha256}), SDR_FRAME_CONVERSION_POLICY.compareFilter);
  assert.throws(() => resolveSdrCheckpointFilter({expected: required, observation: observation(), documentHash, videoSha256}), /EXECUTION_MISMATCH/);
  assert.throws(() => resolveSdrCheckpointFilter({expected, observation: observed, documentHash, videoSha256}), /EXECUTION_MISMATCH/);
  assert.equal(controlledRenderExecutionContractSchema.safeParse({...legacy, sdrAudioMuxPolicy: SDR_AUDIO_MUX_POLICY}).success, false);
  const audio = {codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, start_time: "0", duration: "8"};
  const window = {durationSeconds: 8, frameDurationSeconds: 1 / 25};
  assert.doesNotThrow(() => assertSdrCheckpointStreamProfile({streams: [audio, stream]}, SDR_AUDIO_MUX_POLICY, window));
  assert.throws(() => assertSdrCheckpointStreamProfile({streams: [audio, stream]}), /PROFILE_INVALID/);
  for (const patch of [{sample_rate: "44100"}, {channels: 1}, {codec_name: "opus"}, {start_time: "0.02"}, {duration: undefined}])
    assert.throws(() => assertSdrCheckpointStreamProfile({streams: [{...audio, ...patch}, stream]}, SDR_AUDIO_MUX_POLICY, window), /PROFILE_INVALID/);
  assert.throws(() => assertSdrCheckpointStreamProfile({streams: [audio, stream]}, SDR_AUDIO_MUX_POLICY), /AUDIO_DURATION_INVALID/);
  assert.throws(() => assertSdrCheckpointStreamProfile({streams: [{...audio, duration: "7"}, stream]}, SDR_AUDIO_MUX_POLICY, window), /AUDIO_DURATION_INVALID/);
  const frozen = compositionConformanceContractSchema.parse({...contract(), renderExecution: required});
  const exported = buildControlledComparisonArtifacts({contract: frozen, observation: observed, documentHash, videoSha256});
  assert.equal(exported.receipt.renderExecution?.sdrAudioMuxPolicy, SDR_AUDIO_MUX_POLICY);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: contract()}, frozen), /RENDER_EXECUTION_MISMATCH/);
});
test("inverse rejects wrong/missing stream profile instead of silently interpreting HDR or another chroma layout", () => {
  assert.doesNotThrow(() => assertSdrCheckpointStreamProfile({streams: [stream], format: {duration: "8"}}));
  for (const key of Object.keys(stream)) {
    assert.throws(() => assertSdrCheckpointStreamProfile({streams: [{...stream, [key]: "different"}]}), /DECODE_PROFILE_INVALID/);
    assert.throws(() => assertSdrCheckpointStreamProfile({streams: [{...stream, [key]: undefined}]}), /DECODE_PROFILE_INVALID/);
  }
  for (const streams of [[], [stream, {...stream}], [stream, {codec_type: "audio"}]])
    assert.throws(() => assertSdrCheckpointStreamProfile({streams}), /DECODE_PROFILE_INVALID/);
});

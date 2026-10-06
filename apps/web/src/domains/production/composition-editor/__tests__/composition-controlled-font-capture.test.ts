import assert from "node:assert/strict";
import test from "node:test";
import {startControlledFontCapture, controlledFontUsageEvidenceSchema, validateControlledFontUsageEvidence} from "../qa/composition-controlled-font-capture";
import {createInitialCompositionDocument} from "../composition-document.factory";
import {createCompositionNativeOverlay} from "../composition-native-overlay.factory";
import {NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT} from "../composition-document.types";
import {hashCompositionDocument} from "../composition-document.service";
import {buildSnapshotConformanceContract} from "../composition-snapshot-conformance-contract";
import {controlledRenderExecutionContractSchema} from "../composition-render-execution-contract";
import {conformanceFontPath} from "../composition-conformance-font-bindings";
import {COMPOSITION_TEXT_PARITY_POLICY} from "../composition-text-parity-policy";
import {TEXT_PARITY_REPEATABILITY} from "../qa/composition-text-parity-evidence";
import type {CompositionQaCdpClient} from "../qa/composition-qa-browser";
import {createFontUsageEvidenceFixture} from "./fixtures/composition-font-usage.fixture";
import {bindControlledRendererFontWitness, assertControlledFontWitnessMatchesContract} from "../qa/composition-controlled-font-witness";
import {buildControlledComparisonArtifacts} from "../qa/composition-controlled-comparison-artifacts";
import {rendererFontUsagePendingSchema} from "../composition-font-usage-contract";
import {exportedVideoReceiptSchema} from "../qa/composition-exported-video-conformance";
import {evaluateCompositionConformance} from "../composition-preview-render-conformance";
import {assertConformanceReportMatchesContract} from "../qa/composition-conformance-contract-report-gate";

const font = {fontAssetId: "70000000-0000-4000-8000-000000000001", family: "Editorial", mimeType: "font/woff2" as const,
  checksumSha256: "a".repeat(64), fileSizeBytes: 8};
const origin = "http://127.0.0.1:1234";
const browser = {protocolVersion: "1.3", product: "test", revision: "test", userAgent: "test", jsVersion: "test"};
test("native font receipt binds the comparator and durable summary without replacing pending attestation", async () => {
  const state = fixture(); const capture = await state.start(); state.emit();
  for (const point of state.text.checkpoints) await capture.capture(point);
  const fontEvidence = await capture.finish(state.text);
  const nativeEvidence = {scope: "SDK_SESSION_NATIVE_TEXT_AND_CUSTOM_GLYPHS_NOT_PREVIEW_PARITY",
    fontEvidence, textEvidence: state.text};
  const videoSha256 = "d".repeat(64);
  const bound = bindControlledRendererFontWitness(state.contract, nativeEvidence, videoSha256)!;
  assert.equal(bound.summary.status, "OBSERVED_UNATTESTED");
  const pending = rendererFontUsagePendingSchema.parse({policy: state.contract.fontUsageContract!.policy,
    scope: "RENDERER_GLYPH_PROVENANCE", status: "INCOMPLETE", reason: "RENDERER_FONT_USAGE_EVIDENCE_UNAVAILABLE",
    manifestSha256: fontEvidence.manifestSha256, requiredBindingCount: fontEvidence.bindings.length,
    observedWitness: bound.summary});
  assert.equal(pending.status, "INCOMPLETE");
  const observation = {policy: state.contract.renderExecution!.policy, documentHash: state.contract.documentHash,
    videoSha256, files: state.contract.renderExecution!.files, browserBefore: browser, browserAfter: browser};
  const input = {contract: state.contract, observation, documentHash: state.contract.documentHash, videoSha256};
  assert.throws(() => buildControlledComparisonArtifacts(input), /FONT_REQUIRED/);
  const artifacts = buildControlledComparisonArtifacts({...input, nativeEvidence});
  assert.deepEqual(artifacts.receipt.nativeEvidence, bound.nativeEvidence);
  const visual = evaluateCompositionConformance({contract: state.contract, previewDocumentHash: input.documentHash,
    renderDocumentHash: input.documentHash, samples: []});
  visual.renderExecution = artifacts.execution;
  visual.fontUsage = pending;
  assert.doesNotThrow(() => assertConformanceReportMatchesContract(state.contract, visual, {videoSha256}));
  assert.throws(() => assertConformanceReportMatchesContract(state.contract,
    {...visual, fontUsage: {...pending, observedWitness: {...bound.summary, contractSha256: "e".repeat(64)}}}, {videoSha256}), /BINDING_INVALID/);
  assert.throws(() => assertConformanceReportMatchesContract(state.contract,
    {...visual, incompletenessReasons: visual.incompletenessReasons?.filter(reason => reason !== "RENDERER_FONT_USAGE_UNAVAILABLE")}, {videoSha256}), /ATTESTATION_PENDING/);
  assert.equal(exportedVideoReceiptSchema.safeParse({documentHash: input.documentHash, videoSha256}).success, true);
  for (const field of ["documentHash", "contractSha256", "videoSha256", "manifestSha256"] as const)
    assert.throws(() => assertControlledFontWitnessMatchesContract(state.contract,
      {...bound.summary, [field]: "e".repeat(64)}, videoSha256), /BINDING_INVALID/);
  for (const field of ["checkpointCount", "bindingCount", "elementCount"] as const)
    assert.throws(() => assertControlledFontWitnessMatchesContract(state.contract,
      {...bound.summary, [field]: bound.summary[field] + 1}, videoSha256));
  assert.equal(bindControlledRendererFontWitness(state.contract, undefined, videoSha256), undefined);
  const tampered = structuredClone(nativeEvidence);
  tampered.fontEvidence.checkpoints[0].elements[0].fonts[0].isCustomFont = false;
  assert.throws(() => buildControlledComparisonArtifacts({...input, nativeEvidence: tampered}));
  assert.throws(() => bindControlledRendererFontWitness(state.contract,
    {scope: nativeEvidence.scope, fontEvidence: createFontUsageEvidenceFixture([{frameIndex: 0, timeSeconds: 0}]).fontUsage,
      textEvidence: state.text}, videoSha256));
});
function fixture() {
  const document = createInitialCompositionDocument({animatedDeck: null, assets: [], sourceInsertionMode: "MANUAL",
    plan: {accentColor: "#38BDF8", durationSeconds: 8, title: "Fonts", subtitle: "Controlled"}});
  const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 0});
  if (clip.source.type !== "NATIVE_TEXT") throw new Error("Expected text");
  clip.source.style.fontAssetId = font.fontAssetId; clip.source.style.fontFamily = font.family;
  if (track) document.tracks.push(track); document.clips.push(clip); document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  const execution = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend: "CONTROLLED", sdkVersion: "0.7.106", expectedBrowser: browser,
    files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
      .map(role => [role, {sha256: "b".repeat(64), sizeBytes: 10}]))});
  const contract = buildSnapshotConformanceContract({document, documentHash: hashCompositionDocument(document), assets: [],
    contractVersion: 4, fontUsage: true, fontManifest: [font], renderExecution: execution,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const text = {schemaVersion: 1, policy: COMPOSITION_TEXT_PARITY_POLICY.id, repeatability: TEXT_PARITY_REPEATABILITY,
    checkpoints: contract.textParity.checkpoints.map(point => ({...point, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
      status: "CAPTURED", unavailable: [], regions: point.expectedTexts.map(expected => ({elementId: expected.elementId,
        textSha256: expected.textSha256, ...(expected.visibility ? {visibility: expected.visibility} : {}),
        left: 0, top: 0, width: 100, height: 20}))}))};
  let handler: ((event: Record<string, unknown>) => void) | undefined;
  let fallback = false, changedBrowser = false, changedFiles = false, pinChecks = 0;
  const client: CompositionQaCdpClient = {close() {}, onEvent(_method, callback) {
    handler = callback; return () => {handler = undefined;};
  }, async send(method, params) {
    if (method === "Browser.getVersion") return {...browser, ...(changedBrowser ? {revision: "changed"} : {})};
    if (method === "Runtime.evaluate") return params?.returnByValue ? {result: {value: true}} : {result: {objectId: "native"}};
    if (method === "DOM.requestNode") return {nodeId: 42};
    if (method === "CSS.getPlatformFontsForNode") return {fonts: [{familyName: "Internal Editorial", postScriptName: "Editorial-Regular",
      isCustomFont: !fallback, glyphCount: 8}]};
    return {};
  }};
  return {document, contract, text, client, pinChecks: () => pinChecks, subscribed: () => !!handler,
    emit() {handler?.({font: {fontFamily: font.family, platformFontFamily: "Internal Editorial", src: `${origin}/${conformanceFontPath(font)}`}});},
    fallback() {fallback = true;}, changeBrowser() {changedBrowser = true;}, changeFiles() {changedFiles = true;},
    async start() {return startControlledFontCapture({document, contract, client, origin, fonts: [font], verifyFiles: async () => {
      pinChecks++; if (changedFiles) throw new Error("private file path");
    }});}};
}

test("font cancellation closes only the owned observer and rejects future capture/finish", async () => {
  const state = fixture(), abort = new AbortController();
  let commands = 0, sharedCloses = 0;
  const client = {...state.client, close() {sharedCloses++;}, async send(...args: Parameters<CompositionQaCdpClient["send"]>) {
    commands++; return state.client.send(...args);
  }};
  const capture = await startControlledFontCapture({document: state.document, contract: state.contract, client,
    origin, fonts: [font], verifyFiles: async () => {}, signal: abort.signal});
  state.emit(); abort.abort("private reason");
  const previous = commands;
  await assert.rejects(capture.capture(state.text.checkpoints[0]), /^Error: CONFORMANCE_JOB_EXECUTION_CANCELLED$/);
  await assert.rejects(capture.finish(state.text), /^Error: CONFORMANCE_JOB_EXECUTION_CANCELLED$/);
  assert.equal(commands, previous); assert.equal(sharedCloses, 0); assert.equal(state.subscribed(), false);
  capture.close();
});
test("abort during a glyph query releases its remote handle but cannot accept the late observation", async () => {
  const state = fixture(), abort = new AbortController();
  const calls: string[] = [];
  const client = {...state.client, async send(method: string, params?: Record<string, unknown>) {
    calls.push(method); const result = await state.client.send(method, params);
    if (method === "CSS.getPlatformFontsForNode") abort.abort("private reason");
    return result;
  }};
  const capture = await startControlledFontCapture({document: state.document, contract: state.contract, client,
    origin, fonts: [font], verifyFiles: async () => {}, signal: abort.signal});
  state.emit();
  await assert.rejects(capture.capture(state.text.checkpoints[0]), /^Error: CONFORMANCE_JOB_EXECUTION_CANCELLED$/);
  assert.equal(calls.at(-1), "Runtime.releaseObject");
  assert.equal(state.subscribed(), false);
});
test("pre-abort and cancellation during file verification prevent subsequent font commands", async () => {
  const state = fixture(), abort = new AbortController(); abort.abort();
  let pins = 0;
  await assert.rejects(startControlledFontCapture({document: state.document, contract: state.contract, client: state.client,
    origin, fonts: [font], verifyFiles: async () => {pins++;}, signal: abort.signal}), /EXECUTION_CANCELLED/);
  assert.equal(pins, 0);
  const late = new AbortController();
  await assert.rejects(startControlledFontCapture({document: state.document, contract: state.contract, client: state.client,
    origin, fonts: [font], verifyFiles: async () => {late.abort();}, signal: late.signal}), /EXECUTION_CANCELLED/);
  assert.equal(state.subscribed(), false);
});
test("controlled font collector observes glyphs, pins browser/files and closes without claiming renderer attestation", async () => {
  const state = fixture(); const capture = await state.start(); state.emit();
  await assert.rejects(capture.finish(state.text), /COVERAGE_INCOMPLETE/);
  for (const point of state.text.checkpoints) await capture.capture(point);
  const evidence = await capture.finish(state.text);
  assert.equal(evidence.scope, "LOCAL_CDP_CUSTOM_NATIVE_GLYPHS_NOT_RENDERER_ATTESTATION");
  assert.equal(evidence.checkpoints.length, state.contract.checkpoints.length);
  assert.equal(evidence.manifestSha256, state.contract.fontUsageContract!.manifestSha256);
  assert.ok(state.pinChecks() > state.contract.checkpoints.length);
  assert.equal(state.subscribed(), false);
  await assert.rejects(capture.capture(state.text.checkpoints[0]), /SESSION_INVALID/);
});

test("preview witnesses cannot be relabeled or accepted as controlled evidence", () => {
  const preview = createFontUsageEvidenceFixture([{frameIndex: 0, timeSeconds: 0}]).fontUsage;
  assert.equal(controlledFontUsageEvidenceSchema.safeParse(preview).success, false);
});

test("independent font witness validation rejects foreign contracts, omission and altered glyph provenance", async () => {
  const state = fixture(); const capture = await state.start(); state.emit();
  for (const point of state.text.checkpoints) await capture.capture(point);
  const evidence = await capture.finish(state.text);
  assert.deepEqual(validateControlledFontUsageEvidence(evidence, state.contract, state.text), evidence);
  for (const kind of ["document", "contract", "manifest", "browser", "coverage", "binding", "fallback"] as const) {
    const changed = structuredClone(evidence);
    if (kind === "document") changed.documentHash = "c".repeat(64);
    if (kind === "contract") changed.contractSha256 = "c".repeat(64);
    if (kind === "manifest") changed.manifest[0].checksumSha256 = "c".repeat(64);
    if (kind === "browser") changed.browserAfter.revision = "changed";
    if (kind === "coverage") changed.checkpoints.pop();
    if (kind === "binding") changed.bindings = [];
    if (kind === "fallback") changed.checkpoints[0].elements[0].fonts[0].isCustomFont = false;
    assert.throws(() => validateControlledFontUsageEvidence(changed, state.contract, state.text), kind);
  }
});

test("missing events, fallback glyphs, wrong checkpoints and changed files terminate the collector", async () => {
  for (const kind of ["event", "fallback", "checkpoint", "files"] as const) {
    const state = fixture(); const capture = await state.start();
    if (kind !== "event") state.emit();
    if (kind === "fallback") state.fallback();
    if (kind === "files") state.changeFiles();
    const point = structuredClone(state.text.checkpoints[0]);
    if (kind === "checkpoint") point.timeSeconds += 1;
    await assert.rejects(capture.capture(point), error => error instanceof Error && error.message === "CONTROLLED_RENDER_FONT_CAPTURE_FAILED");
    assert.equal(state.subscribed(), false);
  }
});

test("finalization rejects browser changes and a substituted text witness, preserving cleanup", async () => {
  for (const kind of ["browser", "text"] as const) {
    const state = fixture(); const capture = await state.start(); state.emit();
    for (const point of state.text.checkpoints) await capture.capture(point);
    const text = structuredClone(state.text);
    if (kind === "browser") state.changeBrowser();
    if (kind === "text") text.checkpoints[0].regions[0].width++;
    await assert.rejects(capture.finish(text), /FINALIZATION_FAILED/);
    assert.equal(state.subscribed(), false);
  }
});

test("a changed document or frozen font binding fails before CDP subscription", async () => {
  const state = fixture(); const document = structuredClone(state.document); document.canvas.width++;
  await assert.rejects(startControlledFontCapture({document, contract: state.contract, client: state.client, origin,
    fonts: [font], verifyFiles: async () => {}}), /CONTRACT_REQUIRED/);
  const contract = structuredClone(state.contract); contract.fontUsageContract!.manifestSha256 = "c".repeat(64);
  await assert.rejects(startControlledFontCapture({document: state.document, contract, client: state.client, origin,
    fonts: [font], verifyFiles: async () => {}}), /FROZEN_BINDING_MISMATCH/);
  assert.equal(state.subscribed(), false);
});

test("CDP startup errors are sanitized and release subscriptions", async () => {
  for (const failure of ["Browser.getVersion", "CSS.enable"]) {
    const state = fixture(), send = state.client.send;
    state.client.send = async (method, params) => {
      if (method === failure) throw new Error("private/path/token");
      return send(method, params);
    };
    await assert.rejects(state.start(), error => error instanceof Error
      && ["CONTROLLED_RENDER_FONT_BROWSER_UNAVAILABLE", "CONTROLLED_RENDER_FONT_SETUP_FAILED"].includes(error.message));
    assert.equal(state.subscribed(), false);
  }
});

test("font provenance is checked again on reverse seeks, not inferred from matching text geometry", async () => {
  const state = fixture(); const capture = await state.start(); state.emit();
  for (const point of state.text.checkpoints) await capture.capture(point);
  await capture.verifyRepeat(state.text.checkpoints[0]);
  state.fallback();
  await assert.rejects(capture.verifyRepeat(state.text.checkpoints[0]), /REPEAT_FAILED/);
  assert.equal(state.subscribed(), false);
});

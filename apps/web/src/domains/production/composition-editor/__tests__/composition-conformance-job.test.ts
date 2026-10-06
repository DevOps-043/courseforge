import assert from "node:assert/strict";
import { access, writeFile, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyConformanceJobFailure, processConformanceJob, durableConformanceReportSchema, type DurableConformanceReport } from "../qa/composition-conformance-job-worker";
import { executeConformanceJob } from "../qa/composition-conformance-job-execution";
import {bindConformanceReportToAttempt} from "../qa/composition-conformance-attempt-binding";
import { ConformanceStageFailure } from "../qa/composition-conformance-stage-failure";
import { AUDIO_TIMING_POLICY, AUDIO_RMS_WINDOW_POLICY } from "../qa/composition-audio-conformance-policy";
import { PLAYBACK_CAPTURE_POLICY } from "../qa/composition-playback-capture-runtime";
import { PLAYBACK_AV_POLICY } from "../qa/composition-playback-audio-gate";
import { MEDIA_BOUNDARY_POLICY } from "../qa/composition-playback-boundaries";
import { playbackBoundaryFixture } from "./composition-playback-test-fixtures";
import { COMPOSITION_SSIM_POLICY } from "../composition-visual-metrics-policy";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { DECK_TEXT_PLAN_POLICY } from "../composition-deck-text-plan";
import { DECLARED_NATIVE_FONT_USAGE_POLICY } from "../composition-font-usage-contract";
import { evaluateExportedColorTags, EXPORTED_COLOR_TAG_POLICY } from "../qa/composition-exported-color-tags";
import { eventBatchExecutionSummarySchema } from "../qa/composition-conformance-event-batch-execution";
import { COMPOSITION_CONFORMANCE_THRESHOLDS, compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { aggregateEventVisualMetrics, type EventVisualMetrics } from "../qa/composition-event-visual-metrics";

const identifier = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const claim = { id: identifier(1), organization_id: identifier(2), request_id: identifier(3), revision_id: identifier(4),
  lease_token: identifier(5), attempts: 1 };
const digest = "a".repeat(64), documentHash = "b".repeat(64), visualHash = "c".repeat(64), audioHash = "d".repeat(64);
const integrity = { assetId: identifier(6), checksum: digest, documentHash, sizeBytes: 4, status: "MATCH" as const };
const referenceContract = compositionConformanceContractSchema.parse({schemaVersion: 1, assets: [],
  canvas: {durationSeconds: 1, fps: 25, height: 1080, width: 1920},
  checkpoints: [{frameIndex: 0, timeSeconds: 0, reasons: ["controlled"]}],
  compilerContract: "courseforge-composition-preview-compiler-v1", documentHash,
  renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"},
  thresholds: COMPOSITION_CONFORMANCE_THRESHOLDS});
function report(status: "PASS" | "FAIL" | "INCOMPLETE" = "PASS"): DurableConformanceReport {
  const { status: _status, ...boundIntegrity } = integrity;
  return { reportVersion: 1, scope: "REMOTE_INTEGRITY_AND_PERSISTED_CONFORMANCE", status,
    attemptBinding: bindConformanceReportToAttempt(claim),
    organizationId: claim.organization_id, requestId: claim.request_id, revisionId: claim.revision_id,
    integrity: boundIntegrity, references: { visualChecksum: visualHash, audioChecksum: audioHash },
    comparison: { reportVersion: 2, documentHash, status, video: { sha256: digest, sizeBytes: 4 }, audioTiming: { status,
      method: "STEREO_ENERGY_ENVELOPE_STREAM_V3", policy: { ...AUDIO_TIMING_POLICY },
      rms: { status, policy: { ...AUDIO_RMS_WINDOW_POLICY } } } }, limitations: [] };
}

test("durable execution MATCH preserves pending attestation and rejects wrong bindings or forged PASS", () => {
  const pending = report("INCOMPLETE");
  pending.comparison.visual = {status: "INCOMPLETE", requiredCheckpointCount: 1, checkedCheckpointCount: 0,
    incompletenessReasons: ["RENDER_EXECUTION_ATTESTATION_PENDING"], renderExecution: {
      policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1", scope: "FILE_AND_CDP_MATCH_NOT_ISOLATION_OR_JOB_ATTESTATION",
      status: "MATCH", documentHash, videoSha256: digest, reason: "RENDER_EXECUTION_ATTESTATION_PENDING", mismatches: []}};
  assert.equal(durableConformanceReportSchema.safeParse(pending).success, true);
  for (const mutation of ["document", "video", "reason", "pass", "mismatch"] as const) {
    const changed = structuredClone(pending);
    const visual = changed.comparison.visual!;
    if (mutation === "document") visual.renderExecution!.documentHash = digest;
    if (mutation === "video") visual.renderExecution!.videoSha256 = documentHash;
    if (mutation === "reason") visual.incompletenessReasons = [];
    if (mutation === "pass") {changed.status = "PASS"; changed.comparison.status = "PASS"; visual.status = "PASS";}
    if (mutation === "mismatch") {visual.renderExecution!.status = "MISMATCH"; visual.renderExecution!.mismatches = ["NODE"];}
    assert.equal(durableConformanceReportSchema.safeParse(changed).success, false, mutation);
  }
});

test("durable seek evidence is bounded, document-bound and cannot be promoted to global PASS", () => {
  const pending = report("INCOMPLETE");
  pending.comparison.visual = {status: "INCOMPLETE", requiredCheckpointCount: 1, checkedCheckpointCount: 0,
    incompletenessReasons: ["RENDER_EXECUTION_ATTESTATION_PENDING"], renderExecution: {
      policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1", scope: "FILE_AND_CDP_MATCH_NOT_ISOLATION_OR_JOB_ATTESTATION",
      status: "MATCH", documentHash, videoSha256: digest, reason: "RENDER_EXECUTION_ATTESTATION_PENDING", mismatches: []},
    seekRepeatability: {policy: "EXACT_RGBA_FORWARD_REVERSE_V1", scope: "SDK_SESSION_CHECKPOINTS_NOT_PREVIEW_PARITY_OR_JOB_ATTESTATION",
      status: "PASS", documentHash, contractSha256: visualHash, checkpointCount: 1, byteCounts: {forward: 1, reverse: 1},
      samples: [{frameIndex: 0, timeSeconds: 0, rgbaSha256: audioHash}]}};
  const parsed = durableConformanceReportSchema.parse(pending);
  assert.deepEqual(parsed.comparison.visual!.seekRepeatability, pending.comparison.visual.seekRepeatability);
  for (const mutation of ["document", "execution", "coverage", "pass"] as const) {
    const changed = structuredClone(pending); const visual = changed.comparison.visual!;
    if (mutation === "document") visual.seekRepeatability!.documentHash = digest;
    if (mutation === "execution") delete visual.renderExecution;
    if (mutation === "coverage") visual.seekRepeatability!.samples = [];
    if (mutation === "pass") {changed.status = "PASS"; changed.comparison.status = "PASS"; visual.status = "PASS";}
    assert.equal(durableConformanceReportSchema.safeParse(changed).success, false, mutation);
  }
});

test("durable font witness preserves local evidence and rejects integrity changes or promotion", () => {
  const pending = report("INCOMPLETE");
  pending.comparison.visual = {status: "INCOMPLETE", requiredCheckpointCount: 1,
    incompletenessReasons: ["RENDER_EXECUTION_ATTESTATION_PENDING", "RENDERER_FONT_USAGE_UNAVAILABLE"], renderExecution: {
      policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1", scope: "FILE_AND_CDP_MATCH_NOT_ISOLATION_OR_JOB_ATTESTATION",
      status: "MATCH", documentHash, videoSha256: digest, reason: "RENDER_EXECUTION_ATTESTATION_PENDING", mismatches: []},
    fontUsage: {policy: DECLARED_NATIVE_FONT_USAGE_POLICY, scope: "RENDERER_GLYPH_PROVENANCE", status: "INCOMPLETE",
      reason: "RENDERER_FONT_USAGE_EVIDENCE_UNAVAILABLE", manifestSha256: audioHash, requiredBindingCount: 1,
      observedWitness: {policy: "CONTROLLED_SESSION_CUSTOM_NATIVE_FONT_USAGE_V1",
        scope: "LOCAL_CDP_CUSTOM_NATIVE_GLYPHS_NOT_RENDERER_ATTESTATION", status: "OBSERVED_UNATTESTED",
        documentHash, videoSha256: digest, contractSha256: visualHash, manifestSha256: audioHash,
        evidenceSha256: digest, textEvidenceSha256: visualHash, checkpointCount: 1, bindingCount: 1, elementCount: 1}}};
  assert.deepEqual(durableConformanceReportSchema.parse(pending).comparison.visual?.fontUsage,
    pending.comparison.visual.fontUsage);
  for (const mutation of ["document", "video", "manifest", "bindings", "checkpoints", "reason", "execution", "pass"] as const) {
    const changed = structuredClone(pending); const visual = changed.comparison.visual!;
    const witness = visual.fontUsage!.observedWitness!;
    if (mutation === "document") witness.documentHash = digest;
    if (mutation === "video") witness.videoSha256 = documentHash;
    if (mutation === "manifest") witness.manifestSha256 = digest;
    if (mutation === "bindings") witness.bindingCount++;
    if (mutation === "checkpoints") witness.checkpointCount++;
    if (mutation === "reason") visual.incompletenessReasons = ["RENDER_EXECUTION_ATTESTATION_PENDING"];
    if (mutation === "execution") delete visual.renderExecution;
    if (mutation === "pass") {changed.status = "PASS"; changed.comparison.status = "PASS"; visual.status = "PASS";}
    assert.equal(durableConformanceReportSchema.safeParse(changed).success, false, mutation);
  }
});

test("durable PASS cannot override pending deck text by forging only the visual status", () => {
  const passing = report();
  passing.comparison.visual = {status: "PASS", requiredCheckpointCount: 1, checkedCheckpointCount: 1,
    incompletenessReasons: ["DECK_TEXT_EVIDENCE_INCOMPLETE"]};
  assert.equal(durableConformanceReportSchema.safeParse(passing).success, false);
  passing.status = "INCOMPLETE"; passing.comparison.status = "INCOMPLETE";
  passing.comparison.visual.status = "INCOMPLETE";
  assert.equal(durableConformanceReportSchema.safeParse(passing).success, true);
});
test("durable deck summary preserves regional coverage without granting renderer attestation", () => {
  const pending = report("INCOMPLETE");
  const summary = {policy: DECK_TEXT_PLAN_POLICY, scope: "DECK_SOURCE_TEXT_REGIONS_NOT_RENDER_FONT_ATTESTATION" as const,
    status: "PASS" as const, requiredCheckpointCount: 2, checkedCheckpointCount: 2, expectedRegionCount: 3, checkedRegionCount: 3};
  pending.comparison.visual = {status: "INCOMPLETE", requiredCheckpointCount: 2,
    incompletenessReasons: ["DECK_TEXT_EVIDENCE_INCOMPLETE"], deckText: summary};
  assert.deepEqual(durableConformanceReportSchema.parse(pending).comparison.visual?.deckText, summary);
  for (const patch of [{checkedCheckpointCount: 1}, {checkedRegionCount: 2}, {scope: "RENDER_ATTESTED"}]) {
    const changed = structuredClone(pending);
    Object.assign(changed.comparison.visual!.deckText!, patch);
    assert.equal(durableConformanceReportSchema.safeParse(changed).success, false);
  }
  pending.status = "PASS"; pending.comparison.status = "PASS"; pending.comparison.visual.status = "PASS";
  assert.equal(durableConformanceReportSchema.safeParse(pending).success, false);
});
function queue(options: { idle?: boolean; renew?: boolean; finish?: boolean; finishError?: boolean } = {}) {
  const calls: Array<{ name: string; args: any }> = [];
  const supabase = { async rpc(name: string, args: unknown) {
    calls.push({ name, args });
    if (name === "claim_hyperframes_conformance_job") return { data: options.idle ? [] : [claim], error: null };
    if (name === "renew_hyperframes_conformance_job") return { data: options.renew ?? true, error: null };
    return { data: options.finish ?? true, error: options.finishError ? {} : null };
  } } as unknown as SupabaseClient<any, any, any>;
  return { supabase, calls };
}
test("PASS playback no acepta deriva/inconcluso ni bounds fabricados aunque RMS pase", () => {
  const valid = report();
  valid.comparison.audioTiming.lagMilliseconds = 0;
  valid.comparison.audioPlayback = {status: "PASS", policy: PLAYBACK_AV_POLICY,
    boundaries: {policy: MEDIA_BOUNDARY_POLICY, status: "PASS", checkedClipCount: 1, expectedClipCount: 1, maximumBoundaryErrorUpperBoundMilliseconds: 3},
    effectiveEventToleranceMilliseconds: 40, maximumAvDriftUpperBoundMilliseconds: 10,
    maximumMediaDriftUpperBoundMilliseconds: 5, witness: {policy: PLAYBACK_CAPTURE_POLICY.id, workletSha256: "e".repeat(64),
      originFrame: 0, sampleCount: 48000, packetCount: 500, eventCount: 100, maxClockDriftMilliseconds: 2,
      maxMediaDriftMilliseconds: 2, quantumMilliseconds: 128000 / 48000,
      observation: "BROWSER_MEDIA_GRAPH_NOT_PHYSICAL_DEVICE_OR_SEMANTIC_LIP_SYNC", boundaries: playbackBoundaryFixture(1)}};
  assert.ok(durableConformanceReportSchema.safeParse(valid).success);
  for (const patch of [{status: "INCOMPLETE"}, {maximumAvDriftUpperBoundMilliseconds: 21},
    {witness: {...valid.comparison.audioPlayback.witness, maxClockDriftMilliseconds: 50}},
    {witness: {...valid.comparison.audioPlayback.witness, boundaries: undefined}},
    {boundaries: {...valid.comparison.audioPlayback.boundaries, maximumBoundaryErrorUpperBoundMilliseconds: 0}},
    {boundaries: {...valid.comparison.audioPlayback.boundaries, policy: "unknown-policy"}},
    {witness: {...valid.comparison.audioPlayback.witness, boundaries: {...playbackBoundaryFixture(1), media: []}}}]) {
    assert.equal(durableConformanceReportSchema.safeParse({...valid, comparison: {...valid.comparison,
      audioPlayback: {...valid.comparison.audioPlayback, ...patch}}}).success, false);
  }
});

test("durable reports preserve pending renderer-font provenance and reject a forged global or local PASS", () => {
  const pending = report("INCOMPLETE");
  pending.comparison.visual = {status: "INCOMPLETE", requiredCheckpointCount: 2, fontUsage: {
    policy: DECLARED_NATIVE_FONT_USAGE_POLICY, scope: "RENDERER_GLYPH_PROVENANCE", status: "INCOMPLETE",
    reason: "RENDERER_FONT_USAGE_EVIDENCE_UNAVAILABLE", manifestSha256: digest, requiredBindingCount: 3}};
  assert.deepEqual(durableConformanceReportSchema.parse(pending).comparison.visual?.fontUsage, pending.comparison.visual.fontUsage);
  assert.equal(durableConformanceReportSchema.safeParse({...pending, status: "PASS", comparison: {...pending.comparison, status: "PASS"}}).success, false);
  for (const patch of [{status: "PASS"}, {reason: "PREVIEW_IS_RENDER"}, {requiredBindingCount: 0},
    {scope: "ALL_FONTS"}, {manifestSha256: "invalid"}]) {
    assert.equal(durableConformanceReportSchema.safeParse({...pending, comparison: {...pending.comparison,
      visual: {...pending.comparison.visual, fontUsage: {...pending.comparison.visual.fontUsage, ...patch}}}}).success, false);
  }
});

test("durable global PASS rejects incomplete, mismatched and forged encoded color tags", () => {
  const valid = report();
  const tags = {matrix: "bt709", primaries: "bt709", transfer: "bt709", range: "tv"};
  valid.comparison.colorTags = evaluateExportedColorTags(tags, EXPORTED_COLOR_TAG_POLICY);
  assert.equal(durableConformanceReportSchema.safeParse(valid).success, true);
  for (const colorTags of [evaluateExportedColorTags({...tags, transfer: null}, EXPORTED_COLOR_TAG_POLICY),
    evaluateExportedColorTags({...tags, transfer: "smpte2084"}, EXPORTED_COLOR_TAG_POLICY),
    {...valid.comparison.colorTags, tags: {...tags, primaries: "bt2020"}}]) {
    assert.equal(durableConformanceReportSchema.safeParse({...valid, comparison: {...valid.comparison, colorTags}}).success, false);
    assert.equal(durableConformanceReportSchema.safeParse({...valid, comparison: {...valid.comparison,
      visual: {status: "PASS", requiredCheckpointCount: 1, colorTags}}}).success, false);
  }
});

test("durable report cannot promote pending SDR conversion to PASS when Rec.709 tags match", () => {
  const pending = report("INCOMPLETE");
  pending.comparison.visual = {status: "INCOMPLETE", requiredCheckpointCount: 2,
    incompletenessReasons: ["SDR_PIXEL_CONVERSION_UNATTESTED"],
    colorTags: evaluateExportedColorTags({matrix: "bt709", primaries: "bt709", transfer: "bt709", range: "tv"}, EXPORTED_COLOR_TAG_POLICY)};
  assert.equal(durableConformanceReportSchema.safeParse(pending).success, true);
  assert.equal(durableConformanceReportSchema.safeParse({...pending, status: "PASS", comparison: {...pending.comparison,
    status: "PASS", visual: {...pending.comparison.visual, status: "PASS"}}}).success, false);
});

test("a passing local partition cannot be persisted as global conformance PASS", () => {
  const valid = report("INCOMPLETE");
  valid.comparison.visual = {status: "INCOMPLETE", requiredCheckpointCount: 48,
    checkpointBatchCoverage: {scope: "ONE_EVENT_PARTITION_NOT_GLOBAL_COVERAGE", measuredCheckpointCount: 48, localStatus: "PASS",
      batch: {planSha256: digest, batchIndex: 0, batchCount: 2, totalCheckpointCount: 49}}};
  assert.equal(durableConformanceReportSchema.safeParse(valid).success, true);
  assert.equal(durableConformanceReportSchema.safeParse({...valid, status: "PASS", comparison: {...valid.comparison, status: "PASS",
    visual: {...valid.comparison.visual, status: "PASS"}}}).success, false);
  assert.equal(durableConformanceReportSchema.safeParse({...valid, comparison: {...valid.comparison,
    visual: {...valid.comparison.visual, checkpointBatchCoverage: {...valid.comparison.visual.checkpointBatchCoverage,
      measuredCheckpointCount: 47}}}}).success, false);
});

test("durable PASS cannot override unknown audio expectation or unconfigured loudness", () => {
  const valid = report();
  valid.comparison.audioStatus = "SIGNAL_ABOVE_FLOOR_NOT_FULLY_EVALUATED";
  valid.comparison.audioLoudness = {status: "PASS"};
  assert.equal(durableConformanceReportSchema.safeParse(valid).success, true);
  for (const audioStatus of ["EXPECTATION_UNKNOWN", "MISSING_REQUIRED_TRACK", "REQUIRED_AUDIO_BELOW_FLOOR"] as const)
    assert.equal(durableConformanceReportSchema.safeParse({...valid, comparison: {...valid.comparison, audioStatus}}).success, false);
  for (const status of ["NOT_APPLICABLE", "MEASURED_POLICY_NOT_SET", "FAIL", "MEASUREMENT_FAILED"] as const)
    assert.equal(durableConformanceReportSchema.safeParse({...valid, comparison: {...valid.comparison, audioLoudness: {status}}}).success, false);
  for (const missing of ["audioStatus", "audioLoudness"] as const) {
    const changed = structuredClone(valid); delete changed.comparison[missing];
    assert.equal(durableConformanceReportSchema.safeParse(changed).success, false);
  }
});

test("cola vacía no ejecuta ni cierra un job", async () => {
  const fixture = queue({ idle: true });
  assert.deepEqual(await processConformanceJob(fixture.supabase, async () => { throw new Error("must not execute"); }), { status: "IDLE" });
  assert.equal(fixture.calls.length, 1);
});

test("historical reports remain readable but cannot finalize the current worker claim", async () => {
  const historical = report(); delete historical.attemptBinding;
  assert.equal(durableConformanceReportSchema.safeParse(historical).success, true);
  const fixture = queue();
  const result = await processConformanceJob(fixture.supabase, async () => historical);
  assert.equal(result.status, "FAILED_ATTEMPT");
  assert.equal(fixture.calls[1]!.args.p_report, null);
  assert.equal(fixture.calls[1]!.args.p_retryable, false);
});

test("worker rejects report replay across job, attempt and lease without persisting evidence", async () => {
  for (const changed of [{...claim, id: identifier(90)}, {...claim, attempts: 2},
    {...claim, lease_token: identifier(91)}]) {
    const value = report(); value.attemptBinding = bindConformanceReportToAttempt(changed);
    const fixture = queue();
    const result = await processConformanceJob(fixture.supabase, async () => value);
    assert.equal(result.status, "FAILED_ATTEMPT");
    assert.equal(fixture.calls[1]!.args.p_report, null);
    assert.equal(fixture.calls[1]!.args.p_error_code, "CONFORMANCE_JOB_INPUT_REJECTED");
    assert.equal(fixture.calls[1]!.args.p_retryable, false);
  }
});

test("durable PASS no acepta SSIM ausente, bajo umbral o con cobertura fabricada cuando se declara", () => {
  const valid = report();
  valid.comparison.visual = {status: "PASS", requiredCheckpointCount: 2, ssim: {policy: COMPOSITION_SSIM_POLICY.id,
    minimumRequired: 0.995, minimumObserved: 1, checkedCheckpointCount: 2}};
  assert.ok(durableConformanceReportSchema.safeParse(valid).success);
  for (const patch of [{minimumObserved: null}, {minimumObserved: 0.994}, {checkedCheckpointCount: 1}, {minimumRequired: 0.9}]) {
    const changed: unknown = {...valid, comparison: {...valid.comparison, visual: {...valid.comparison.visual,
      ssim: {...valid.comparison.visual.ssim, ...patch}}}};
    assert.equal(durableConformanceReportSchema.safeParse(changed).success, false);
  }
});
test("durable PASS rejects incomplete or forged native-text coverage", () => {
  const valid = report();
  valid.comparison.visual = {status: "PASS", requiredCheckpointCount: 2, textParity: {
    policy: COMPOSITION_TEXT_PARITY_POLICY.id, scope: "NATIVE_TEXT_AND_CAPTIONS", status: "PASS",
    checkedCheckpointCount: 2, requiredCheckpointCount: 2, expectedRegionCount: 3, checkedRegionCount: 3}};
  assert.ok(durableConformanceReportSchema.safeParse(valid).success);
  for (const patch of [{status: "FAIL"}, {status: "INCOMPLETE"}, {checkedCheckpointCount: 1},
    {requiredCheckpointCount: 1}, {checkedRegionCount: 2}, {expectedRegionCount: 4},
    {policy: "unknown"}, {scope: "ALL_TEXT"}]) {
    assert.equal(durableConformanceReportSchema.safeParse({...valid, comparison: {...valid.comparison,
      visual: {...valid.comparison.visual, textParity: {...valid.comparison.visual.textParity, ...patch}}}}).success, false);
  }
});
for (const status of ["PASS", "FAIL", "INCOMPLETE"] as const) {
  test(`persiste medición ${status} como ejecución exitosa sin aprobar QA`, async () => {
    const fixture = queue();
    const result = await processConformanceJob(fixture.supabase, async () => report(status));
    assert.equal(result.status, "SUCCEEDED"); assert.equal("conformanceStatus" in result && result.conformanceStatus, status);
    assert.equal(fixture.calls[1]!.args.p_report.comparison.status, status);
    assert.equal(fixture.calls[1]!.args.p_error_code, null);
  });
}
test("contexto ajeno y reporte sin audio no se persisten", async () => {
  for (const mutation of [
    (value: DurableConformanceReport) => { value.organizationId = identifier(99); },
    (value: DurableConformanceReport) => { value.comparison.audioTiming.status = "NOT_REQUESTED" as any; },
    (value: DurableConformanceReport) => { value.comparison.video.sha256 = "f".repeat(64); },
    (value: DurableConformanceReport) => { value.comparison.documentHash = "f".repeat(64); },
    (value: DurableConformanceReport) => { value.comparison.audioTiming.status = "FAIL"; },
    (value: DurableConformanceReport) => { value.comparison.audioTiming.rms.status = "NOT_REQUESTED"; },
    (value: DurableConformanceReport) => { value.comparison.audioTiming.rms.status = "FAIL"; },
    (value: DurableConformanceReport) => { value.comparison.audioTiming.policy.id = "stereo-envelope-v1" as any; },
  ]) {
    const fixture = queue(), value = report(); mutation(value);
    assert.equal((await processConformanceJob(fixture.supabase, async () => value)).status, "FAILED_ATTEMPT");
    assert.equal(fixture.calls[1]!.args.p_report, null);
  }
});
test("clasifica errores sin guardar detalles sensibles", async () => {
  assert.deepEqual(classifyConformanceJobFailure(new Error("https://signed.example/?token=secret")),
    { code: "CONFORMANCE_JOB_EXECUTION_FAILED", retryable: true });
  assert.equal(classifyConformanceJobFailure(new Error("VIDEO_INTEGRITY_OVERWRITTEN")).retryable, false);
  const fixture = queue();
  await processConformanceJob(fixture.supabase, async () => { throw new Error("secret"); });
  assert.equal(fixture.calls[1]!.args.p_error_code, "CONFORMANCE_JOB_EXECUTION_FAILED");
});

test("worker persists the failed execution stage without provider details or a forged conformance report", async () => {
  const fixture = queue();
  const result = await processConformanceJob(fixture.supabase, async () => {
    throw new ConformanceStageFailure("PREVIEW_REFERENCE", new Error("https://private.invalid/?token=secret"));
  });
  assert.equal(result.status, "FAILED_ATTEMPT");
  assert.equal(result.failureStage, "PREVIEW_REFERENCE");
  assert.equal(fixture.calls[1]!.args.p_error_code, "CONFORMANCE_JOB_PREVIEW_REFERENCE_FAILED");
  assert.equal(fixture.calls[1]!.args.p_report, null);
  assert.ok(!JSON.stringify(fixture.calls).includes("secret"));
});
test("renueva reserva durante ejecución y drena antes del cierre", async () => {
  const fixture = queue();
  await processConformanceJob(fixture.supabase, async () => { await delay(35); return report(); }, 10);
  assert.ok(fixture.calls.some((call) => call.name === "renew_hyperframes_conformance_job"));
  assert.equal(fixture.calls.at(-1)!.name, "finish_hyperframes_conformance_job");
  const count = fixture.calls.length; await delay(25); assert.equal(fixture.calls.length, count);
});
test("reserva perdida no publica ni cierra resultados tardíos", async () => {
  const fixture = queue({ renew: false });
  assert.equal((await processConformanceJob(fixture.supabase, async () => { await delay(35); return report(); }, 10)).status, "LEASE_LOST");
  assert.equal(fixture.calls.filter((call) => call.name.startsWith("finish_")).length, 0);
});

test("lost ownership signals the running executor before accepting any late report", async () => {
  const fixture = queue({renew: false}); let cancelled = false;
  const result = await processConformanceJob(fixture.supabase, async (_claim, signal) => {
    await new Promise<void>(resolve => signal.addEventListener("abort", () => {cancelled = true; resolve();}, {once: true}));
    return report();
  }, 10);
  assert.equal(cancelled, true); assert.equal(result.status, "LEASE_LOST");
  assert.equal(fixture.calls.some(call => call.name.startsWith("finish_")), false);
});

test("pre-aborted worker does not claim and shutdown cannot persist a successful report", async () => {
  const stopped = new AbortController(); stopped.abort("private token"); const idle = queue();
  assert.deepEqual(await processConformanceJob(idle.supabase, async () => report(), undefined, {signal: stopped.signal}), {status: "STOPPED"});
  assert.equal(idle.calls.length, 0);
  const shutdown = new AbortController(), fixture = queue();
  const result = await processConformanceJob(fixture.supabase, async () => {shutdown.abort("private token"); return report();},
    undefined, {signal: shutdown.signal});
  assert.equal(result.status, "FAILED_ATTEMPT"); assert.equal(fixture.calls.at(-1)!.args.p_report, null);
  assert.equal(fixture.calls.at(-1)!.args.p_retryable, true);
});

test("timed-out renewal aborts the RPC and cannot publish an executor's late success", async () => {
  const fixture = queue(); const original = fixture.supabase.rpc.bind(fixture.supabase); let renewalSignal: AbortSignal | undefined;
  (fixture.supabase as any).rpc = (name: string, args: unknown) => {
    if (name !== "renew_hyperframes_conformance_job") return original(name, args as never);
    const pending = new Promise(() => {});
    return Object.assign(pending, {abortSignal(signal: AbortSignal) {renewalSignal = signal; return pending;}});
  };
  const result = await processConformanceJob(fixture.supabase, async (_claim, signal) => {
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), {once: true})); return report();
  }, 10, {renewalTimeoutMs: 20});
  assert.equal(result.status, "LEASE_LOST"); assert.equal(renewalSignal!.aborted, true);
  assert.equal(fixture.calls.some(call => call.name.startsWith("finish_")), false);
});

test("shutdown while draining renewal invalidates a report already returned by the executor", async () => {
  const fixture = queue(), shutdown = new AbortController(); const original = fixture.supabase.rpc.bind(fixture.supabase);
  let started!: () => void, finishRenewal!: (value: unknown) => void;
  const renewalStarted = new Promise<void>(resolve => {started = resolve;});
  (fixture.supabase as any).rpc = (name: string, args: unknown) => {
    if (name !== "renew_hyperframes_conformance_job") return original(name, args as never);
    started(); return new Promise(resolve => {finishRenewal = resolve;});
  };
  const running = processConformanceJob(fixture.supabase, async () => {await renewalStarted; return report();}, 10,
    {signal: shutdown.signal, renewalTimeoutMs: 500});
  await renewalStarted; await delay(0); shutdown.abort("private reason"); finishRenewal({data: true, error: null});
  assert.equal((await running).status, "FAILED_ATTEMPT"); assert.equal(fixture.calls.at(-1)!.args.p_report, null);
});
test("CAS de cierre perdido no se declara éxito", async () => {
  const fixture = queue({ finish: false });
  assert.equal((await processConformanceJob(fixture.supabase, async () => report())).status, "LEASE_LOST");
});
test("confirmación de cierre perdida no provoca segundo write de fallo", async () => {
  const fixture = queue({ finishError: true });
  await assert.rejects(processConformanceJob(fixture.supabase, async () => report()), /CONFORMANCE_JOB_FINISH_FAILED/);
  assert.equal(fixture.calls.length, 2);
});
test("reporte mayor a 1 MiB se rechaza antes de la RPC", async () => {
  const fixture = queue(), value = report(); value.comparison.extra = "x".repeat(1024 ** 2);
  await processConformanceJob(fixture.supabase, async () => value);
  assert.equal(fixture.calls[1]!.args.p_report, null);
});

function executionFixture(options: { changeRemote?: boolean; wrongReference?: boolean; failure?: boolean; status?: "FAIL" | "INCOMPLETE" } = {}) {
  const calls: string[] = [];
  let ownedDirectory = "";
  const params = { claim, supabase: queue().supabase, supabaseUrl: "https://project.supabase.co", ffmpegPath: "controlled-ffmpeg" };
  const adapters = {
    async snapshot(input: { destinationPath: string }) {
      calls.push("snapshot"); ownedDirectory = dirname(input.destinationPath);
      await writeFile(input.destinationPath, "test", { flag: "wx" }); return integrity;
    },
    async recheck() { calls.push("recheck"); return options.changeRemote ? { ...integrity, checksum: "f".repeat(64) } : integrity; },
  };
  // Stage adapters are controlled; these tests exercise coordination and real owned-file cleanup, not browser/codec quality.
  const evidence = {
    async events() {return null;},
    async visual() { calls.push("visual"); return { documentHash, projectHash: digest, organizationId: claim.organization_id,
      revisionId: claim.revision_id, checksum: visualHash }; },
    async audio() { calls.push("audio"); if (options.failure) throw new Error("controlled failure"); return { checksum: audioHash }; },
    async compare() { calls.push("compare"); return { reference: { documentHash, projectHash: digest, contract: referenceContract,
      organizationId: claim.organization_id, revisionId: claim.revision_id, checksum: options.wrongReference ? digest : visualHash },
      audioReference: { checksum: audioHash }, report: report(options.status).comparison }; },
  } as unknown as NonNullable<Parameters<typeof executeConformanceJob>[2]>;
  return { params, adapters, evidence, calls, directory: () => ownedDirectory };
}

test("whole execution budget accumulates across stages, cancels once and prevents the next stage", async () => {
  const state = executionFixture(); let milliseconds = 0; const signals: AbortSignal[] = [];
  const wrap = (target: any, name: string) => {
    const original = target[name];
    target[name] = async (input: {signal: AbortSignal}, ...args: unknown[]) => {
      signals.push(input.signal); milliseconds += 350;
      return original(input, ...args);
    };
  };
  wrap(state.adapters, "snapshot"); wrap(state.evidence, "visual"); wrap(state.evidence, "audio");
  await assert.rejects(executeConformanceJob(state.params, state.adapters, state.evidence,
    {timeoutMilliseconds: 1000, clock: () => milliseconds}), error => error instanceof ConformanceStageFailure
      && error.stage === "AUDIO_REFERENCE" && error.message === "CONFORMANCE_JOB_DEADLINE_TIMEOUT" && error.retryable);
  assert.deepEqual(state.calls, ["snapshot", "visual", "audio"]);
  assert.equal(signals.length, 3); assert.ok(signals.every(signal => signal === signals[0] && signal.aborted));
  await assert.rejects(access(state.directory()));
});

test("worker stores an execution timeout as a retryable failed attempt, never a conformance report", async () => {
  const state = executionFixture(), worker = queue(); let milliseconds = 0;
  const snapshot = state.adapters.snapshot;
  state.adapters.snapshot = async params => {const result = await snapshot(params); milliseconds = 1000; return result;};
  const result = await processConformanceJob(worker.supabase, async (_claim, signal) =>
    executeConformanceJob({...state.params, signal}, state.adapters, state.evidence,
      {timeoutMilliseconds: 1000, clock: () => milliseconds}));
  assert.equal(result.status, "FAILED_ATTEMPT"); assert.equal(result.failureStage, "REMOTE_SNAPSHOT");
  const finish = worker.calls.at(-1)!;
  assert.equal(finish.args.p_report, null); assert.equal(finish.args.p_retryable, true);
  assert.equal(finish.args.p_error_code, "CONFORMANCE_JOB_REMOTE_SNAPSHOT_FAILED");
  await assert.rejects(access(state.directory()));
});

test("deadline at each adapter boundary preserves the failed stage and cleans owned files", async () => {
  const stages = {snapshot: "REMOTE_SNAPSHOT", visual: "PREVIEW_REFERENCE", audio: "AUDIO_REFERENCE",
    compare: "RENDER_COMPARISON", events: "EVENT_COMPARISON", recheck: "REMOTE_RECHECK"} as const;
  for (const [name, stage] of Object.entries(stages)) {
    const state = executionFixture(); let milliseconds = 0;
    const target: any = name === "snapshot" || name === "recheck" ? state.adapters : state.evidence;
    const original = target[name];
    target[name] = async (...args: unknown[]) => {const result = await original(...args); milliseconds = 1000; return result;};
    await assert.rejects(executeConformanceJob(state.params, state.adapters, state.evidence,
      {timeoutMilliseconds: 1000, clock: () => milliseconds}), error => error instanceof ConformanceStageFailure
        && error.stage === stage && error.message === "CONFORMANCE_JOB_DEADLINE_TIMEOUT" && error.retryable);
    await assert.rejects(access(state.directory()));
  }
});

test("real deadline cancels a pending adapter and waits for its owned write before cleanup", async () => {
  const state = executionFixture(); const snapshot = state.adapters.snapshot;
  let observedSignal: AbortSignal | undefined, writeFinished = false;
  state.adapters.snapshot = async (params: Parameters<typeof snapshot>[0]) => {
    const signal = (params as typeof params & {signal: AbortSignal}).signal;
    observedSignal = signal;
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), {once: true}));
    const result = await snapshot(params); writeFinished = true; return result;
  };
  await assert.rejects(executeConformanceJob(state.params, state.adapters, state.evidence,
    {timeoutMilliseconds: 1000}), error => error instanceof ConformanceStageFailure
      && error.stage === "REMOTE_SNAPSHOT" && error.message === "CONFORMANCE_JOB_DEADLINE_TIMEOUT" && error.retryable);
  assert.equal(observedSignal?.aborted, true); assert.equal(writeFinished, true);
  assert.deepEqual(state.calls, ["snapshot"]);
  await assert.rejects(access(state.directory()));
});

test("budget policy rejects invalid durations before snapshot and never treats late cleanup as success", async () => {
  for (const timeoutMilliseconds of [0, 999, 600001, NaN, Infinity]) {
    const state = executionFixture();
    await assert.rejects(executeConformanceJob(state.params, state.adapters, state.evidence,
      {timeoutMilliseconds}), /CONTROLLED_RENDER_DEADLINE_INVALID/);
    assert.deepEqual(state.calls, []);
  }
  const state = executionFixture(); let observationsAfterRecheck = 0, done = false;
  const recheck = state.adapters.recheck;
  state.adapters.recheck = async () => {const result = await recheck(); done = true; return result;};
  await assert.rejects(executeConformanceJob(state.params, state.adapters, state.evidence, {
    timeoutMilliseconds: 1000, clock: () => done && ++observationsAfterRecheck >= 2 ? 1000 : 0,
  }), error => error instanceof ConformanceStageFailure && error.stage === "RESOURCE_CLEANUP" && error.retryable);
  await assert.rejects(access(state.directory()));
});

test("cancellation at every job stage prevents the next stage and still cleans owned files", async () => {
  for (const cancelledStage of ["snapshot", "visual", "audio", "compare", "events", "recheck"] as const) {
    const state = executionFixture(), cancellation = new AbortController();
    const target = ["snapshot", "recheck"].includes(cancelledStage) ? state.adapters : state.evidence;
    const original = (target as any)[cancelledStage];
    (target as any)[cancelledStage] = async (...args: unknown[]) => {
      const value = await original(...args); cancellation.abort("private reason"); return value;
    };
    await assert.rejects(executeConformanceJob({...state.params, signal: cancellation.signal}, state.adapters, state.evidence),
      /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
    await assert.rejects(access(state.directory()));
    assert.equal(state.calls.at(-1), cancelledStage === "events" ? "compare" : cancelledStage);
  }
});

test("orchestration identifies each failed adapter boundary and still removes its owned files", async () => {
  for (const stage of ["REMOTE_SNAPSHOT", "PREVIEW_REFERENCE", "AUDIO_REFERENCE", "RENDER_COMPARISON", "EVENT_COMPARISON", "REMOTE_RECHECK"] as const) {
    const state = executionFixture();
    const fail = async () => {throw new Error("https://private.invalid/?token=secret");};
    if (stage === "REMOTE_SNAPSHOT") {
      const snapshot = state.adapters.snapshot;
      state.adapters.snapshot = async (params) => {await snapshot(params); return fail();};
    } else if (stage === "PREVIEW_REFERENCE") state.evidence.visual = fail;
    else if (stage === "AUDIO_REFERENCE") state.evidence.audio = fail;
    else if (stage === "RENDER_COMPARISON") state.evidence.compare = fail;
    else if (stage === "EVENT_COMPARISON") state.evidence.events = fail;
    else state.adapters.recheck = fail;
    await assert.rejects(executeConformanceJob(state.params, state.adapters, state.evidence),
      (error: unknown) => error instanceof ConformanceStageFailure && error.stage === stage && !error.message.includes("secret"));
    await assert.rejects(access(state.directory()));
  }
});

test("final worker rejects a comparison that drops the authorized reference contract", async () => {
  const state = executionFixture();
  const compare = state.evidence.compare;
  state.evidence.compare = async (params) => {
    const result = await compare(params);
    const changed = structuredClone(result);
    delete (changed.reference as Partial<typeof changed.reference>).contract;
    return changed;
  };
  await assert.rejects(executeConformanceJob(state.params, state.adapters, state.evidence),
    (error: unknown) => error instanceof ConformanceStageFailure && error.stage === "RENDER_COMPARISON");
  await assert.rejects(access(state.directory()));
});

test("failed cleanup does not erase the primary stage or recursively delete unexpected files", async () => {
  const state = executionFixture(); let unexpectedPath = "";
  state.evidence.audio = async () => {
    unexpectedPath = join(state.directory(), "unexpected-controlled.txt");
    await writeFile(unexpectedPath, "controlled", {flag: "wx"});
    throw new Error("https://private.invalid/?token=secret");
  };
  try {
    await assert.rejects(executeConformanceJob(state.params, state.adapters, state.evidence),
      (error: unknown) => error instanceof ConformanceStageFailure && error.stage === "AUDIO_REFERENCE" && error.cleanupFailed);
    await access(unexpectedPath);
  } finally {if (unexpectedPath) {await rm(unexpectedPath); await rmdir(state.directory());}}
});

function eventSummary(status: "PASS" | "FAIL" | "INCOMPLETE" = "PASS") {
  const incomplete = status === "INCOMPLETE";
  return eventBatchExecutionSummarySchema.parse({schemaVersion: 1,
    scope: "COMPLETE_NATIVE_EVENT_VISUAL_SAMPLE_COVERAGE_NOT_FULL_RENDER_ATTESTATION",
    organizationId: claim.organization_id, revisionId: claim.revision_id, projectHash: digest, videoSha256: digest,
    documentHash, parentContractSha256: "e".repeat(64), planSha256: "f".repeat(64), status,
    requiredBatchCount: 2, measuredBatchCount: 2, resumedBatchCount: 1, requiredCheckpointCount: 49,
    measuredCheckpointCount: incomplete ? 48 : 49, batches: [
      {batchIndex: 0, packetSha256: visualHash, status: "PASS", measuredCheckpointCount: 48},
      {batchIndex: 1, packetSha256: audioHash, status, measuredCheckpointCount: incomplete ? 0 : 1},
    ]});
}

function bindEventRootComparison(state: ReturnType<typeof executionFixture>) {
  const compare = state.evidence.compare;
  state.evidence.compare = async (params) => {
    const compared = await compare(params);
    return {...compared, report: {...compared.report, visual: {status: "INCOMPLETE", requiredCheckpointCount: 48,
      incompletenessReasons: ["EVENT_PARTITION_COVERAGE"],
      checkpointBatchCoverage: {scope: "ONE_EVENT_PARTITION_NOT_GLOBAL_COVERAGE", measuredCheckpointCount: 48,
        localStatus: "PASS", batch: {planSha256: "f".repeat(64), batchIndex: 0, batchCount: 2, totalCheckpointCount: 49}}}}} as never;
  };
}

test("event job executes all partitions before the second integrity check and never promotes root INCOMPLETE", async () => {
  for (const status of ["PASS", "FAIL", "INCOMPLETE"] as const) {
    const state = executionFixture({status: "INCOMPLETE"});
    bindEventRootComparison(state);
    state.evidence.events = async (params) => {
      state.calls.push("events"); assert.equal(params.videoSha256, digest); assert.equal(params.projectHash, digest);
      return eventSummary(status);
    };
    const result = await executeConformanceJob(state.params, state.adapters, state.evidence);
    assert.equal(result.status, status === "FAIL" ? "FAIL" : "INCOMPLETE");
    assert.equal(result.comparison.preEventComparisonStatus, "INCOMPLETE");
    assert.equal(result.comparison.status, result.status);
    assert.equal(result.eventCheckpointExecution?.measuredBatchCount, 2);
    assert.equal(result.eventVisualCoverageGate?.status, status === "FAIL" ? "FAIL" : "INCOMPLETE");
    assert.ok(result.eventVisualCoverageGate?.blockedReasons.includes("AGGREGATE_METRICS_MISSING"));
    assert.equal(result.eventMeasurementGate?.status, status === "FAIL" ? "FAIL" : "INCOMPLETE");
    assert.equal(durableConformanceReportSchema.safeParse({...result, eventMeasurementGate: {
      ...result.eventMeasurementGate, status: "PASS", visualCoverageStatus: "PASS", nonVisualStatus: "PASS", blockedReasons: [],
    }}).success, false);
    assert.equal(result.eventVisualCoverageGate?.scope, "VISUAL_SAMPLE_GATES_NOT_AUDIO_ENVIRONMENT_OR_RENDER_ATTESTATION");
    assert.equal(durableConformanceReportSchema.safeParse({...result, eventVisualCoverageGate: {
      ...result.eventVisualCoverageGate, status: "INCOMPLETE", blockedReasons: ["COLOR_TAGS_INCOMPLETE"],
    }}).success, false);
    assert.deepEqual(state.calls, ["snapshot", "visual", "audio", "compare", "events", "recheck"]);
    await assert.rejects(access(state.directory()));
  }
});

test("event metric policy must match the measured root, even when aggregate coverage passes", async () => {
  const state = executionFixture({status: "INCOMPLETE"}); bindEventRootComparison(state);
  const comparison = state.evidence.compare;
  state.evidence.compare = async (params) => {
    const result = await comparison(params);
    return {...result, report: {...result.report, visual: {...result.report.visual,
      thresholds: {...COMPOSITION_CONFORMANCE_THRESHOLDS}, ssim: {policy: COMPOSITION_SSIM_POLICY.id,
        minimumRequired: COMPOSITION_SSIM_POLICY.minimum, minimumObserved: 1, checkedCheckpointCount: 48}}}} as never;
  };
  const summary = eventSummary();
  summary.batches = summary.batches.map((batch) => {
    const count = batch.measuredCheckpointCount;
    const metrics: EventVisualMetrics = {scope: "NATIVE_EVENT_VISUAL_METRICS_NOT_FULL_RENDER_ATTESTATION",
      thresholds: {...COMPOSITION_CONFORMANCE_THRESHOLDS}, requiredCheckpointCount: count, checkedCheckpointCount: count,
      observed: {maxMeanAbsoluteError: 0, maxMismatchedPixelRatio: 0, maxTemporalDriftFrames: 0, minPsnrDb: 99},
      ssim: {policy: COMPOSITION_SSIM_POLICY.id, minimumRequired: COMPOSITION_SSIM_POLICY.minimum, minimumObserved: 1, checkedCheckpointCount: count},
      textParity: {policy: COMPOSITION_TEXT_PARITY_POLICY.id, scope: "NATIVE_TEXT_AND_CAPTIONS", status: "PASS",
        requiredCheckpointCount: count, checkedCheckpointCount: count, expectedRegionCount: 0, checkedRegionCount: 0}};
    return {...batch, visualMetrics: metrics};
  });
  summary.visualMetrics = aggregateEventVisualMetrics(summary.batches.map((batch) => batch.visualMetrics!));
  state.evidence.events = async () => summary;
  const result = await executeConformanceJob(state.params, state.adapters, state.evidence);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.eventVisualCoverageGate?.status, "PASS");
  for (const failure of ["missing", "threshold", "ssim"] as const) {
    const changed = structuredClone(result);
    if (failure === "missing") delete changed.comparison.visual!.thresholds;
    if (failure === "threshold") changed.comparison.visual!.thresholds!.maxMeanAbsoluteError += 1;
    if (failure === "ssim") changed.comparison.visual!.ssim!.minimumRequired = 0.5 as typeof COMPOSITION_SSIM_POLICY.minimum;
    assert.equal(durableConformanceReportSchema.safeParse(changed).success, false);
  }
});

test("event summary rejects forged coverage, foreign scope and a changed remote video", async () => {
  const summary = eventSummary();
  for (const patch of [{measuredCheckpointCount: 48}, {measuredBatchCount: 1},
    {batches: [summary.batches[0], summary.batches[0]]}, {status: "FAIL"}]) {
    assert.equal(eventBatchExecutionSummarySchema.safeParse({...summary, ...patch}).success, false);
  }
  for (const failure of ["scope", "remote", "project"] as const) {
    const state = executionFixture({status: "INCOMPLETE", changeRemote: failure === "remote"});
    bindEventRootComparison(state);
    state.evidence.events = async () => ({...summary,
      ...(failure === "scope" ? {organizationId: identifier(99)} : {}),
      ...(failure === "project" ? {projectHash: "e".repeat(64)} : {})});
    await assert.rejects(executeConformanceJob(state.params, state.adapters, state.evidence), /EVENT_EXECUTION_MISMATCH|REMOTE_CHANGED|EVENT_PROJECT/);
    await assert.rejects(access(state.directory()));
  }
});

test("event-contract job cannot omit aggregate execution after comparing its root partition", async () => {
  const state = executionFixture({status: "INCOMPLETE"}); bindEventRootComparison(state);
  await assert.rejects(executeConformanceJob(state.params, state.adapters, state.evidence), /EVENT_EXECUTION_REQUIRED/);
  assert.equal(state.calls.includes("recheck"), false);
  await assert.rejects(access(state.directory()));
});
for (const status of ["FAIL", "INCOMPLETE"] as const) {
  test(`secuencia completa conserva ${status}, vínculo y limitaciones`, async () => {
    const fixture = executionFixture({ status });
    const result = await executeConformanceJob(fixture.params, fixture.adapters, fixture.evidence);
    assert.equal(result.status, status); assert.equal(result.integrity.checksum, digest);
    assert.deepEqual(result.attemptBinding, bindConformanceReportToAttempt(fixture.params.claim));
    assert.equal(JSON.stringify(result).includes(fixture.params.claim.lease_token), false);
    assert.deepEqual(fixture.calls, ["snapshot", "visual", "audio", "compare", "recheck"]);
    assert.ok(result.limitations.includes("NOT_QA_OR_PUBLICATION_APPROVAL"));
    await assert.rejects(access(fixture.directory()));
  });
}
test("job con playback solicitado rechaza fallback a evidencia del modelo de fuentes", async () => {
  const fixture = executionFixture();
  await assert.rejects(executeConformanceJob({...fixture.params, capturePlaybackAudio: true}, fixture.adapters, fixture.evidence), /PLAYBACK_EVIDENCE_MISSING/);
  await assert.rejects(access(fixture.directory()));
});

test("selected color policy reaches comparison, survives persistence and cannot silently disappear", async () => {
  for (const missing of [false, true]) {
    const fixture = executionFixture({status: "INCOMPLETE"}), compare = fixture.evidence.compare;
    fixture.evidence.compare = async (params) => {
      assert.equal(params.colorTagPolicyId, EXPORTED_COLOR_TAG_POLICY);
      const result = await compare(params);
      if (!missing) result.report.colorTags = evaluateExportedColorTags({matrix: null, primaries: "bt709", transfer: "bt709", range: "tv"}, EXPORTED_COLOR_TAG_POLICY);
      return result;
    };
    const run = executeConformanceJob({...fixture.params, colorTagPolicyId: EXPORTED_COLOR_TAG_POLICY}, fixture.adapters, fixture.evidence);
    if (missing) await assert.rejects(run, /COLOR_TAG_EVIDENCE_MISSING_INVALID/);
    else {
      const result = await run;
      assert.equal(result.comparison.colorTags?.status, "INCOMPLETE");
      assert.deepEqual(result.comparison.colorTags?.missing, ["matrix"]);
    }
    await assert.rejects(access(fixture.directory()));
  }
});

test("execution preserves renderer font incompleteness and exposes its actionable limitation", async () => {
  const fixture = executionFixture({status: "INCOMPLETE"});
  const compare = fixture.evidence.compare;
  fixture.evidence.compare = async (params) => {
    const result = await compare(params);
    result.report.visual = {status: "INCOMPLETE", requiredCheckpointCount: 2,
      checkedCheckpointCount: 2, failures: [], observed: {maxMeanAbsoluteError: 0, maxMismatchedPixelRatio: 0,
        maxTemporalDriftFrames: 0, minPsnrDb: 99}, fontUsage: {
        policy: DECLARED_NATIVE_FONT_USAGE_POLICY, scope: "RENDERER_GLYPH_PROVENANCE", status: "INCOMPLETE",
        reason: "RENDERER_FONT_USAGE_EVIDENCE_UNAVAILABLE", manifestSha256: digest, requiredBindingCount: 3}};
    return result;
  };
  const result = await executeConformanceJob(fixture.params, fixture.adapters, fixture.evidence);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.comparison.visual?.fontUsage?.requiredBindingCount, 3);
  assert.ok(result.limitations.includes("RENDERER_FONT_USAGE_EVIDENCE_UNAVAILABLE"));
  await assert.rejects(access(fixture.directory()));
});

for (const scenario of ["changeRemote", "wrongReference", "failure"] as const) {
  test(`rechaza ${scenario} y limpia únicamente su workspace`, async () => {
    const fixture = executionFixture({ [scenario]: true });
    await assert.rejects(executeConformanceJob(fixture.params, fixture.adapters, fixture.evidence));
    await assert.rejects(access(fixture.directory()));
  });
}

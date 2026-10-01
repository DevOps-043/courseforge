import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyConformanceJobFailure, processConformanceJob, durableConformanceReportSchema, type DurableConformanceReport } from "../qa/composition-conformance-job-worker";
import { executeConformanceJob } from "../qa/composition-conformance-job-execution";
import { AUDIO_TIMING_POLICY, AUDIO_RMS_WINDOW_POLICY } from "../qa/composition-audio-conformance-policy";
import { PLAYBACK_CAPTURE_POLICY } from "../qa/composition-playback-capture-runtime";
import { PLAYBACK_AV_POLICY } from "../qa/composition-playback-audio-gate";
import { MEDIA_BOUNDARY_POLICY } from "../qa/composition-playback-boundaries";
import { playbackBoundaryFixture } from "./composition-playback-test-fixtures";
import { COMPOSITION_SSIM_POLICY } from "../composition-visual-metrics-policy";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { DECLARED_NATIVE_FONT_USAGE_POLICY } from "../composition-font-usage-contract";
import { evaluateExportedColorTags, EXPORTED_COLOR_TAG_POLICY } from "../qa/composition-exported-color-tags";

const identifier = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const claim = { id: identifier(1), organization_id: identifier(2), request_id: identifier(3), revision_id: identifier(4),
  lease_token: identifier(5), attempts: 1 };
const digest = "a".repeat(64), documentHash = "b".repeat(64), visualHash = "c".repeat(64), audioHash = "d".repeat(64);
const integrity = { assetId: identifier(6), checksum: digest, documentHash, sizeBytes: 4, status: "MATCH" as const };
function report(status: "PASS" | "FAIL" | "INCOMPLETE" = "PASS"): DurableConformanceReport {
  const { status: _status, ...boundIntegrity } = integrity;
  return { reportVersion: 1, scope: "REMOTE_INTEGRITY_AND_PERSISTED_CONFORMANCE", status,
    organizationId: claim.organization_id, requestId: claim.request_id, revisionId: claim.revision_id,
    integrity: boundIntegrity, references: { visualChecksum: visualHash, audioChecksum: audioHash },
    comparison: { reportVersion: 2, documentHash, status, video: { sha256: digest, sizeBytes: 4 }, audioTiming: { status,
      method: "STEREO_ENERGY_ENVELOPE_STREAM_V3", policy: { ...AUDIO_TIMING_POLICY },
      rms: { status, policy: { ...AUDIO_RMS_WINDOW_POLICY } } } }, limitations: [] };
}
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

test("cola vacía no ejecuta ni cierra un job", async () => {
  const fixture = queue({ idle: true });
  assert.deepEqual(await processConformanceJob(fixture.supabase, async () => { throw new Error("must not execute"); }), { status: "IDLE" });
  assert.equal(fixture.calls.length, 1);
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
    async visual() { calls.push("visual"); return { documentHash, projectHash: digest, organizationId: claim.organization_id,
      revisionId: claim.revision_id, checksum: visualHash }; },
    async audio() { calls.push("audio"); if (options.failure) throw new Error("controlled failure"); return { checksum: audioHash }; },
    async compare() { calls.push("compare"); return { reference: { documentHash, projectHash: digest,
      organizationId: claim.organization_id, revisionId: claim.revision_id, checksum: options.wrongReference ? digest : visualHash },
      audioReference: { checksum: audioHash }, report: report(options.status).comparison }; },
  } as unknown as NonNullable<Parameters<typeof executeConformanceJob>[2]>;
  return { params, adapters, evidence, calls, directory: () => ownedDirectory };
}
for (const status of ["FAIL", "INCOMPLETE"] as const) {
  test(`secuencia completa conserva ${status}, vínculo y limitaciones`, async () => {
    const fixture = executionFixture({ status });
    const result = await executeConformanceJob(fixture.params, fixture.adapters, fixture.evidence);
    assert.equal(result.status, status); assert.equal(result.integrity.checksum, digest);
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

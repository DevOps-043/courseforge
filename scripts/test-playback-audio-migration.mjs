import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Lexical regression guards only. These do NOT replace PostgreSQL parsing, RLS or concurrency QA.
const migration = readFileSync(new URL("../supabase/migrations/20261001130000_persist_playback_audio_evidence.sql", import.meta.url), "utf8");
const queue = readFileSync(new URL("../supabase/migrations/20260930160000_queue_full_conformance_reports.sql", import.meta.url), "utf8");
test("playback migration contains exactly one complete replacement function and grant", () => {
  assert.equal((migration.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 1);
  assert.equal((migration.match(/^END;$/gm) ?? []).length, 1);
  assert.equal((migration.match(/\$\$/g) ?? []).length, 2);
  assert.equal((migration.match(/^GRANT EXECUTE/gm) ?? []).length, 1);
  assert.ok(migration.trimEnd().endsWith("TO service_role;"));
});

test("v3 contract durable PASS requires frozen SSIM policy and full checkpoint coverage", () => {
  for (const guard of ["'{conformance_contract,schemaVersion}' NOT IN ('3','4')", "ssim-gaussian-11-coded-bt709-luma-v1",
    "'{comparison,visual,ssim,minimumObserved}')::numeric BETWEEN 0.995 AND 1",
    "'{comparison,visual,ssim,checkedCheckpointCount}'", "jsonb_array_length(v.manifest #> '{conformance_contract,checkpoints}')"]) {
    assert.ok(queue.includes(guard), guard);
  }
});

test("v4 durable PASS requires scoped native text policy and independent frozen candidate count", () => {
  for (const guard of ["'{conformance_contract,schemaVersion}' <> '4'", "text-region-rgb-shift-one-v1", "NATIVE_TEXT_AND_CAPTIONS",
    "'{comparison,visual,textParity,status}' = 'PASS'", "sum(jsonb_array_length(entry->'expectedTexts'))"]) assert.ok(queue.includes(guard), guard);
});
test("v1/v2 bounds remain explicit and v3 binds native capture to canonical conversion", () => {
  for (const guard of ["p_receipt->>'schemaVersion' = '1'", "v_duration_limit := 120", "p_file_size_bytes <= 8388608",
    "p_receipt->>'schemaVersion' = '2'", "p_receipt->>'mixChunkFrames' = '80000'", "p_receipt->>'schemaVersion' = '3'",
    "BROWSER_MEDIA_OUTPUT_PCM_CANONICAL_V3", "FFMPEG_ARESAMPLE_8K_STEREO_NO_GAIN_OR_LAG_CORRECTION",
    "'{native,sampleRate}' = '48000'", "p_receipt->>'status' IS DISTINCT FROM v_status", "p_file_size_bytes > 50331648"]) {
    assert.ok(migration.includes(guard), guard);
  }
});
test("v3 registration preserves scoped visual pin, exact samples and least privilege", () => {
  for (const guard of ["p_receipt->'visualFrames' IS DISTINCT FROM v_visual.frames", "'{playback,sampleCount}'",
    "ceil((p_receipt->>'durationSeconds')::numeric * 48000)", "organization_id = p_organization_id FOR SHARE",
    "e.receipt = p_receipt", "FROM PUBLIC, anon, authenticated", "TO service_role",
    "browser-media-boundaries-v1", "invalid playback boundary coverage", "invalid playback boundary row",
    "count(DISTINCT entry #>> '{window,clipId}')", "count(DISTINCT entry #>> '{window,elementId}')"]) assert.ok(migration.includes(guard), guard);
});
test("durable closure validates playback witness and recomputes uncertainty before accepting PASS", () => {
  for (const guard of ["audio.receipt->>'schemaVersion' <> '3'", "browser-av-clock-and-boundaries-v2", "browser-media-boundaries-v1",
    "jsonb_array_elements(audio.receipt #> '{playback,boundaries,media}')", "(boundary->>'unexpectedStops')::integer = 0",
    "p_report #> '{comparison,audioPlayback,witness}' = audio.receipt->'playback'",
    "'{comparison,audioPlayback,status}' = 'PASS'", "'{comparison,audioTiming,lagMilliseconds}'",
    "'{playback,quantumMilliseconds}')::numeric + 5 <= 20", "1000.0 / (v.manifest #>> '{conformance_contract,canvas,fps}')::numeric"]) {
    assert.ok(queue.includes(guard), guard);
  }
});

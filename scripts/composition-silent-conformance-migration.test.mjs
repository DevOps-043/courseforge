import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const migration = await readFile(new URL("../supabase/migrations/20261008200000_support_silent_conformance_reports.sql", import.meta.url), "utf8");
const original = await readFile(new URL("../supabase/migrations/20260930160000_queue_full_conformance_reports.sql", import.meta.url), "utf8");

test("prepared silent SQL patches each original fragment exactly once and preserves non-audio gates", () => {
  const fragments = [...migration.matchAll(/\$source\$([\s\S]*?)\$source\$,\s*\$target\$([\s\S]*?)\$target\$/g)];
  assert.equal(fragments.length, 7);
  let transformed = original;
  for (const [, source, target] of fragments) {
    assert.equal(transformed.split(source).length - 1, 1, source);
    transformed = transformed.replace(source, target);
  }
  for (const gate of ["FOR UPDATE", "j.status = 'RUNNING'", "j.lease_token = p_lease_token", "j.lease_expires_at > now()",
    "a.checksum = p_report", "visual.bundle_sha256 = p_report", "comparison,visual,textParity", "comparison,visual,ssim",
    "audio.receipt->'playback'", "audio.bundle_sha256 = p_report", "status = 'SUCCEEDED',report = p_report"])
    assert.ok(transformed.includes(gate), gate);
  assert.ok(transformed.includes("LEFT JOIN private.hyperframes_audio_conformance_evidence audio ON p_report->>'reportVersion' = '1'"));
  assert.ok(transformed.includes("v.manifest#>'{conformance_contract,audio,required}' = 'false'::jsonb"));
  assert.ok(migration.includes("CONFORMANCE_SILENT_MIGRATION_PRECONDITION_INVALID"));
});

test("SQL silent timing literal equals the Node canonical unrequested report, not fabricated measurements", () => {
  const {audioTimingReport} = require("./dist/composition-worker/domains/production/composition-editor/qa/composition-exported-audio-timing.js");
  const literal = migration.match(/\$timing\$([\s\S]*?)\$timing\$::jsonb/)?.[1];
  assert.ok(literal);
  assert.deepEqual(JSON.parse(literal), audioTimingReport("NOT_REQUESTED"));
});

test("prepared SQL is private-only, fail-closed and never deletes or rewrites evidence", () => {
  assert.ok(migration.includes("REVOKE ALL ON FUNCTION private.verify_hyperframes_silent_audio_report(jsonb) FROM PUBLIC, anon, authenticated, service_role"));
  assert.ok(migration.includes("pg_get_functiondef('private.finish_hyperframes_conformance_job_before_events"));
  assert.ok(migration.includes("p_report->>'status' NOT IN ('FAIL','INCOMPLETE')"));
  assert.ok(migration.includes("(p_report->'references') ? 'audioChecksum'"));
  assert.ok(migration.includes("(p_report->'comparison') ? 'audioPlayback'"));
  assert.doesNotMatch(migration, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE|GRANT EXECUTE)\b/i);
});

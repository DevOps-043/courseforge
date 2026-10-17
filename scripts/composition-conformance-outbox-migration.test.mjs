import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const migration = await readFile(new URL("../supabase/migrations/20261008220000_defer_conformance_render_reservations.sql", import.meta.url), "utf8");

test("outbox is private, bounded, checksum-protected and immutable per exact request", () => {
  for (const fragment of ["ENABLE ROW LEVEL SECURITY", "BETWEEN 1 AND 20971520", "ON CONFLICT (request_id) DO NOTHING",
    "v_existing.execution_id IS DISTINCT FROM p_execution_id", "v_existing.reservation_text IS DISTINCT FROM p_reservation_text",
    "v_existing.reservation_sha256 IS DISTINCT FROM p_reservation_sha256", "ON DELETE RESTRICT"])
    assert.ok(migration.includes(fragment), fragment);
  assert.match(migration, /REVOKE ALL ON private.hyperframes_conformance_render_outbox FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /v_job_payload_bytes > 20971520/);
  assert.ok(migration.indexOf("v_job_payload_bytes > 20971520") < migration.indexOf("INSERT INTO private.hyperframes_conformance_render_outbox"));
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public.stage_hyperframes_conformance_render_reservation\([^;]+ TO service_role/);
  assert.doesNotMatch(migration, /GRANT [^;]+ TO (?:anon|authenticated)/);
});

test("staging requires consumed authority, exact receipt/contract/references and current nonrevocation", () => {
  for (const fragment of ["status = 'CONSUMED'", "read_consumed_composition_render_execution",
    "v_recovered#>>'{context,key,revoked}' IS DISTINCT FROM 'false'",
    "v_reservation->>'supervisorReceiptSha256' IS DISTINCT FROM v_execution.receipt_sha256",
    "v_reservation->'binding' IS DISTINCT FROM v_execution.receipt#>'{payload,binding}'",
    "IS DISTINCT FROM v_execution.contract", "v_execution.contract_sha256", "visualChecksum", "audioChecksum",
    "composition_revision_id = p_revision_id FOR NO KEY UPDATE"])
    assert.ok(migration.includes(fragment), fragment);
});

test("both job-first and outbox-first routes attach transactionally through existing reservation validation", () => {
  assert.match(migration, /IF v_job_id IS NOT NULL THEN PERFORM private.attach_hyperframes_conformance_render_outbox\(v_job_id\)/);
  assert.match(migration, /AFTER INSERT ON private.hyperframes_conformance_jobs/);
  assert.match(migration, /private.attach_hyperframes_conformance_render_outbox\(NEW.id\)/);
  assert.match(migration, /public.register_hyperframes_conformance_render_reservation\(v_job.id, v_job.organization_id/);
  assert.match(migration, /'jobId', v_job.id::text/);
  assert.match(migration, /v_text := v_reservation::text/);
  assert.match(migration, /encode\(sha256\(convert_to\(v_text, 'UTF8'\)\), 'hex'\)/);
  assert.ok(migration.trim().startsWith("-- PREPARED ONLY."));
  assert.ok(migration.trim().endsWith("COMMIT;"));
  assert.doesNotMatch(migration, /UPDATE private.hyperframes_conformance_jobs|ORDER BY|LIMIT 1|conformance_approved/);
});

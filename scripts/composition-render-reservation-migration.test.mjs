import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20261008210000_reserve_conformance_render_inputs.sql", import.meta.url), "utf8");
test("prepared reservation registry is immutable, private, bounded and exact-byte hashed", () => {
  for (const fragment of ["BEGIN;", "COMMIT;", "ENABLE ROW LEVEL SECURITY", "20971520",
    "sha256(convert_to(reservation_text, 'UTF8'))", "ON CONFLICT (job_id) DO NOTHING",
    "v_existing.reservation_text IS DISTINCT FROM p_reservation_text", "CONFORMANCE_JOB_RESERVATION_CONFLICT"])
    assert.ok(sql.includes(fragment), fragment);
  assert.doesNotMatch(sql, /\b(?:DO UPDATE|DELETE FROM|TRUNCATE|ON DELETE CASCADE)\b/i);
  assert.match(sql, /REVOKE ALL ON private\.hyperframes_conformance_render_reservations FROM PUBLIC, anon, authenticated, service_role/);
});

test("prepared reader requires exact job scope and current lease, not latest execution", () => {
  const reader = sql.slice(sql.indexOf("CREATE FUNCTION public.read_hyperframes_conformance_render_reservation"));
  for (const fragment of ["job.id = p_job_id", "job.organization_id = p_organization_id", "job.request_id = p_request_id",
    "job.revision_id = p_revision_id", "job.status = 'RUNNING'", "job.lease_token = p_lease_token",
    "job.lease_expires_at > now()", "execution.status = 'CONSUMED'"])
    assert.ok(reader.includes(fragment), fragment);
  assert.doesNotMatch(reader, /ORDER BY|LIMIT 1/i);
});

test("prepared writer checks consumed ledger, original binding, exact references and revision contract", () => {
  for (const fragment of ["public.read_consumed_composition_render_execution", "context,key,revoked",
    "v_execution.receipt#>'{payload,binding}'", "v_execution.receipt_sha256", "v_execution.contract_sha256",
    "WITH ORDINALITY", "selected.value->'batchIndex'", "v_execution.contract#>'{audio,required}'",
    "CONFORMANCE_JOB_RESERVATION_CONTRACT_INVALID", "FOR SHARE"])
    assert.ok(sql.includes(fragment), fragment);
});

test("prepared finalizer binds reservation checksum and references without bypassing previous gates", () => {
  for (const fragment of ["p_report->'reservationEvidence' IS DISTINCT FROM jsonb_build_object",
    "p_report->'referenceSelection' IS DISTINCT FROM v_manifest->'referenceSelection'",
    "p_report#>'{renderEvidence,binding}' IS DISTINCT FROM v_manifest->'binding'",
    "CONFORMANCE_JOB_DURABLE_RESERVATION_MISSING", "RETURN private.finish_hyperframes_conformance_job_before_reservation("])
    assert.ok(sql.includes(fragment), fragment);
});

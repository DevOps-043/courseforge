// Lexical regression guards only: not PostgreSQL execution/RLS/concurrency proof.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261006080000_html_editing_operation_receipts.sql", import.meta.url), "utf8");
const commit = migration.split("CREATE FUNCTION public.commit_html_editing_operation")[1].split("END $$;")[0];
const read = migration.split("CREATE FUNCTION public.read_html_editing_operation")[1].split("END $$;")[0];

test("receipt storage is private, RLS enabled, bounded and owner/draft/id keyed", () => {
  assert.match(migration, /PRIMARY KEY \(organization_id,draft_id,actor_id,operation_id\)/);
  assert.match(migration, /octet_length\(receipt::text\) <= 4096/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON private\.composition_html_operation_receipts FROM PUBLIC,anon,authenticated,service_role/);
});
test("commit uses draft-first NOWAIT and current actor/template authorization before receipt lookup", () => {
  assert.ok(commit.indexOf("FOR UPDATE NOWAIT") < commit.indexOf("private.assert_html_editing_actor"));
  assert.ok(commit.indexOf("private.assert_html_editing_actor") < commit.indexOf("SELECT * INTO stored"));
  assert.match(commit, /AND NOT revoked FOR UPDATE/);
});
test("recorded ID is bound to clip/request digest and never re-appended", () => {
  assert.match(commit, /stored\.clip_id IS DISTINCT FROM p_clip_id OR stored\.request_sha256 IS DISTINCT FROM p_request_sha256/);
  assert.ok(commit.indexOf("RETURN stored.receipt") < commit.indexOf("public.append_html_editing_revision"));
});
test("receipt insert and nested native/HTML append share a single transaction", () => {
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.ok(commit.indexOf("public.append_html_editing_revision") < commit.indexOf("INSERT INTO private.composition_html_operation_receipts"));
  assert.doesNotMatch(commit, /EXCEPTION WHEN others|dblink|pg_background/i);
});
test("no-op checks native/editorial CAS and exact unchanged content", () => {
  assert.match(commit, /d\.document_hash IS DISTINCT FROM p_expected_document_hash/);
  assert.match(commit, /r\.version IS DISTINCT FROM p_expected_version/);
  assert.match(commit, /p_document IS DISTINCT FROM d\.document/);
  assert.match(commit, /p_revision IS DISTINCT FROM r\.revision/);
  assert.match(commit, /private\.html_editing_grants/);
  assert.match(commit, /HTML_EDITING_ASSET_NOT_AUTHORIZED/);
});
test("receipt is explicitly historical, not current/render authority", () => {
  assert.match(commit, /EDITORIAL_OPERATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED/);
  assert.match(commit, /EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED/);
  assert.doesNotMatch(commit, /'active'|'rendered'|'retryable'/);
});
test("reader reauthorizes current actor and template, isolates owner/id, never writes", () => {
  assert.match(read, /private\.assert_html_editing_actor/);
  assert.match(read, /AND clip_id = p_clip_id AND NOT revoked FOR SHARE/);
  assert.match(read, /actor_id = p_actor_id AND operation_id = p_operation_id/);
  assert.doesNotMatch(read, /INSERT INTO|DELETE FROM|UPDATE private/);
  assert.match(read, /'status','NOT_FOUND'/);
});
test("RPC access remains service-only and no UPDATE/DELETE endpoint is installed", () => {
  assert.equal((migration.match(/TO service_role/g) ?? []).length, 2);
  assert.equal((migration.match(/FROM PUBLIC,anon,authenticated;/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /UPDATE private\.composition_html_operation_receipts|DELETE FROM private\.composition_html_operation_receipts/);
});

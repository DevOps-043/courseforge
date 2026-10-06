import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Lexical safety guards only; not evidence of PostgreSQL execution/atomicity/RLS.
const migration = readFileSync(new URL("../supabase/migrations/20261006090000_html_editing_initialization_receipts.sql", import.meta.url), "utf8");
const commit = migration.split("CREATE FUNCTION public.commit_html_editing_initialization_operation")[1].split("CREATE FUNCTION public.read_html_editing_initialization_operation")[0];
const reader = migration.split("CREATE FUNCTION public.read_html_editing_initialization_operation")[1];
test("initial receipt storage is private, RLS enabled, bounded and owner/draft/operation keyed", () => {
  assert.match(migration, /CREATE TABLE private\.composition_html_initialization_receipts/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(migration, /PRIMARY KEY \(organization_id,draft_id,actor_id,operation_id\)/);
  assert.match(migration, /octet_length\(receipt::text\) <= 4096/);
});
test("initial commit locks draft-first NOWAIT and reauthorizes actor before receipt lookup", () => {
  assert.ok(commit.indexOf("FOR UPDATE NOWAIT") < commit.indexOf("SELECT * INTO stored"));
  assert.ok(commit.indexOf("assert_html_editing_actor") < commit.indexOf("SELECT * INTO stored"));
  assert.match(commit, /state = 'ACTIVE'/);
});
test("initial duplicate ID validates clip/digest/request and returns historical receipt before registration", () => {
  assert.match(commit, /stored\.clip_id IS DISTINCT FROM p_clip_id/);
  assert.match(commit, /stored\.request_sha256 IS DISTINCT FROM p_request_sha256/);
  assert.match(commit, /HTML_INITIALIZATION_OPERATION_ID_REUSED/);
  assert.ok(commit.indexOf("RETURN stored.receipt") < commit.indexOf("created := public.register_html_editing_template_v2"));
  assert.match(commit.slice(0, commit.indexOf("RETURN stored.receipt")), /NOT revoked FOR SHARE/);
});
test("initial registration and receipt insertion are in one transaction without native document append", () => {
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(commit, /created := public\.register_html_editing_template_v2/);
  assert.match(commit, /INSERT INTO private\.composition_html_initialization_receipts/);
  assert.doesNotMatch(commit, /append_html_editing_revision|append_video_composition|EXCEPTION WHEN OTHERS/);
});
test("receipt confirms exact initial revision/hash/template and carries no source HTML", () => {
  assert.match(commit, /AND version = 1/);
  assert.match(commit, /r\.sha256 IS DISTINCT FROM p_revision_sha256/);
  assert.match(commit, /t\.initial_revision IS DISTINCT FROM p_revision/);
  const receipt = commit.slice(commit.indexOf("result_receipt :="));
  assert.match(receipt, /'version',1/); assert.match(receipt, /HTML_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED/);
  assert.doesNotMatch(receipt, /'sourceHtml'|'document',|'grantedAssetIds'/);
});
test("initial receipt reader reauthorizes current owner/draft/template and never registers or writes", () => {
  assert.match(reader, /assert_html_editing_actor/); assert.match(reader, /state = 'ACTIVE' FOR SHARE/);
  assert.match(reader, /AND actor_id = p_actor_id AND operation_id = p_operation_id AND clip_id = p_clip_id/);
  assert.match(reader, /AND NOT revoked FOR SHARE/);
  assert.doesNotMatch(reader, /INSERT INTO|UPDATE private|DELETE FROM|register_html_editing_template/);
});
test("missing initialization receipt stays NOT_FOUND and does not require an installed template", () => {
  assert.match(reader, /'status','NOT_FOUND'/);
  assert.ok(reader.indexOf("'status','NOT_FOUND'") < reader.indexOf("FROM private.composition_html_templates"));
  assert.doesNotMatch(reader, /retryable|retryAllowed/);
});
test("initial receipt RPCs remain service-only without expiration or update/delete endpoint", () => {
  assert.equal((migration.match(/TO service_role/g) ?? []).length, 2);
  assert.equal((migration.match(/FROM PUBLIC,anon,authenticated;/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /UPDATE private\.composition_html_initialization_receipts|DELETE FROM private\.composition_html_initialization_receipts|ON DELETE CASCADE/);
});

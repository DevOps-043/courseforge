import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

// Static contract inspection only: this is not execution, SQL parsing, locks or concurrency validation.
const migration = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261006040000_narrative_extraction_atomic_receipts.sql"), "utf8");
test("prepared receipt migration is additive, service-only, scoped and RLS protected", () => {
  assert.match(migration, /PREPARED ONLY/);
  assert.match(migration, /PRIMARY KEY \(organization_id, draft_id, actor_id, command_id\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE.*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public.commit_narrative_voice_extraction.*TO service_role/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|CREATE OR REPLACE FUNCTION public.append_video/);
});
test("atomic receipt insertion follows native append in the same function", () => {
  const append = migration.indexOf("SELECT * INTO appended FROM public.append_video_composition_draft_document_v2");
  const insert = migration.indexOf("INSERT INTO public.narrative_extraction_receipts");
  assert.ok(append > 0 && insert > append);
  assert.match(migration, /IF appended.outcome IS DISTINCT FROM 'APPENDED' THEN RAISE EXCEPTION/);
  assert.match(migration, /FOR UPDATE NOWAIT/);
  assert.match(migration, /FOR SHARE NOWAIT/);
  assert.match(migration, /p_document IS DISTINCT FROM expected_doc/);
  assert.match(migration, /asset.checksum IS DISTINCT FROM/);
  assert.match(migration, /scene->'wordTimestamps' IS DISTINCT FROM asset.metadata->'word_timestamps'/);
});
test("receipt deduplication runs before base revision and fresh source checks", () => {
  const receiptRead = migration.indexOf("SELECT * INTO prior");
  const currentRead = migration.indexOf("SELECT * INTO current_doc");
  assert.ok(receiptRead > 0 && currentRead > receiptRead);
  assert.match(migration, /'COMMAND_REUSED'/);
  assert.match(migration, /'REPLAYED','receipt',prior.receipt/);
});

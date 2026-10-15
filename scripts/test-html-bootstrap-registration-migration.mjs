import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Lexical regression checks only; NOT SQL syntax/RLS/locks/concurrency evidence.
const source = readFileSync(new URL("../supabase/migrations/20261006050000_html_editing_bootstrap_registration.sql", import.meta.url), "utf8");
const required = [
  "BEGIN;", "COMMIT;", "SECURITY DEFINER SET search_path = pg_catalog,public,private",
  "p_used_asset_ids IS NULL", "cardinality(p_used_asset_ids) > 6400",
  "array_position(p_used_asset_ids,NULL) IS NOT NULL", "count(DISTINCT item)",
  "public.register_html_editing_template(p_organization_id,p_draft_id,p_actor_id,p_clip_id,",
  "private.html_editing_grants(p_organization_id,p_draft_id,p_revision)",
  "IF NOT grants ? asset_id::text", "RAISE EXCEPTION 'HTML_EDITING_ASSET_NOT_AUTHORIZED'",
  "FROM PUBLIC,anon,authenticated", "TO service_role",
];
for (const guard of required) assert.ok(source.includes(guard), `Missing bootstrap guard: ${guard}`);
assert.ok(source.indexOf("created := public.register_html_editing_template") < source.indexOf("grants := private.html_editing_grants"));
assert.ok(source.indexOf("HTML_EDITING_ASSET_NOT_AUTHORIZED") < source.indexOf("RETURN created;"));
assert.doesNotMatch(source, /DELETE FROM|TRUNCATE |CREATE TRIGGER|storage\.objects/i);
const reader = readFileSync(new URL("../supabase/migrations/20261006060000_read_html_editing_bootstrap_context.sql", import.meta.url), "utf8");
const readerGuards = [
  "SECURITY DEFINER SET search_path = pg_catalog,public,private",
  "WHERE id = p_draft_id AND organization_id = p_organization_id AND state = 'ACTIVE' FOR SHARE",
  "private.assert_html_editing_actor(p_organization_id,p_actor_id)",
  "ORDER BY version DESC LIMIT 1", "d.document_hash IS DISTINCT FROM p_expected_document_hash",
  "source_clip#>>'{source,type}' IS DISTINCT FROM 'DECK_SLIDE'",
  "d.document#>'{htmlEditing,items}'", "r.id = c.active_revision_id",
  "r.composition_id = c.id AND r.organization_id = p_organization_id FOR SHARE OF c,r",
  "l.draft_id = p_draft_id AND l.organization_id = p_organization_id AND a.organization_id = p_organization_id",
  "ORDER BY a.id LIMIT 6401 FOR SHARE OF l,a", "jsonb_array_length(grants) > 6400",
  "octet_length(result::text) > 16777216", "FROM PUBLIC,anon,authenticated", "TO service_role",
];
for (const guard of readerGuards) assert.ok(reader.includes(guard), `Missing reader guard: ${guard}`);
assert.doesNotMatch(reader, /INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE |storage\.objects/i);
const history = readFileSync(new URL("../supabase/migrations/20261006070000_read_html_editing_restore_revision.sql", import.meta.url), "utf8");
const historyGuards = [
  "SECURITY DEFINER SET search_path = pg_catalog,public,private",
  "p_restore_version NOT BETWEEN 1 AND 1000000", "p_restore_sha256 !~ '^[a-f0-9]{64}$'",
  "public.read_html_editing_revision(p_organization_id,p_draft_id,p_clip_id,p_actor_id)",
  "organization_id = p_organization_id AND draft_id = p_draft_id AND clip_id = p_clip_id",
  "version = p_restore_version AND sha256 = p_restore_sha256 FOR SHARE",
  "historical.revision->>'sourceHtml' IS DISTINCT FROM current_context#>>'{revision,sourceHtml}'",
  "historical.revision->'manifest' IS DISTINCT FROM current_context#>'{revision,manifest}'",
  "FROM PUBLIC,anon,authenticated", "TO service_role",
];
for (const guard of historyGuards) assert.ok(history.includes(guard), `Missing history guard: ${guard}`);
assert.doesNotMatch(history, /INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE |storage\.objects/i);
console.info(`${required.length + readerGuards.length + historyGuards.length + 5} lexical bootstrap/reader/history guards pass; migrations not applied or executed.`);

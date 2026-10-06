import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

// Lexical regression guards ONLY: no PostgreSQL syntax/RLS/locks/atomicity proof.
const resources = await readFile("supabase/migrations/20261006000000_html_snapshot_resource_validation.sql","utf8");
const commit = await readFile("supabase/migrations/20261006010000_commit_html_editing_snapshot.sql","utf8");
const reconcile = await readFile("supabase/migrations/20261006020000_read_html_snapshot_operation.sql","utf8");
const intents = await readFile("supabase/migrations/20261006030000_html_snapshot_durable_intents.sql","utf8");
const guards = [
  [resources,/REVOKE ALL ON FUNCTION private\.html_snapshot_resource_bindings[\s\S]*service_role/],
  [resources,/jsonb_array_length\(p_assets\) > 250/], [resources,/jsonb_array_length\(p_fonts\) > 32/],
  [resources,/FOR SHARE OF a,l/g], [resources,/FOR SHARE OF a,b/],
  [resources,/HTML_SNAPSHOT_RESOURCE_IDENTITY_CHANGED/], [resources,/HTML_SNAPSHOT_FONT_IDENTITY_CHANGED/],
  [resources,/video_composition_draft_sound_effect_assets/], [resources,/video_composition_draft_branding/],
  [commit,/ENABLE ROW LEVEL SECURITY/], [commit,/REVOKE ALL ON private\.composition_html_snapshot_operations[\s\S]*service_role/],
  [commit,/PRIMARY KEY \(organization_id,operation_id\)/], [commit,/FOR UPDATE NOWAIT/g],
  [commit,/private\.assert_html_editing_actor\(p_org,p_actor\)/],
  [commit,/public\.read_html_editing_compilation\(p_org,p_draft,p_actor/],
  [commit,/HTML_SNAPSHOT_HTML_GRANT_REVOKED/], [commit,/private\.html_snapshot_resource_bindings/],
  [commit,/previous\.request IS DISTINCT FROM request/], [commit,/HTML_SNAPSHOT_ACTIVE_CHANGED/],
  [commit,/native\.document_hash IS DISTINCT FROM manifest/], [commit,/active_revision_id IS DISTINCT FROM p_expected_active/],
  [commit,/HTML_SNAPSHOT_LINK_CONFLICT/], [commit,/UPDATE public\.video_compositions SET active_revision_id/],
  [commit,/GRANT EXECUTE ON FUNCTION public\.commit_html_editing_snapshot[\s\S]*TO service_role/],
  [reconcile,/FOR SHARE/g], [reconcile,/private\.assert_html_editing_actor\(p_org,p_actor\)/],
  [reconcile,/operation\.actor_id IS DISTINCT FROM p_actor/],
  [reconcile,/operation\.composition_id IS DISTINCT FROM p_composition/], [reconcile,/operation\.draft_id IS DISTINCT FROM p_draft/],
  [reconcile,/archive->>'projectHash' IS DISTINCT FROM p_project_hash/],
  [reconcile,/manifest->>'draft_document_hash' IS DISTINCT FROM p_document_hash/],
  [reconcile,/public\.read_html_editing_compilation\(p_org,p_draft,p_actor,p_document_hash\)/],
  [reconcile,/HTML_SNAPSHOT_HTML_GRANT_REVOKED/], [reconcile,/private\.html_snapshot_resource_bindings/],
  [reconcile,/v\.manifest = manifest AND v\.project_hash = p_project_hash/],
  [reconcile,/currentActiveRevisionId/],
  [reconcile,/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC,anon,authenticated/],
  [reconcile,/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/],
  [commit,/CREATE TABLE private\.composition_html_snapshot_intents/],
  [commit,/REVOKE ALL ON private\.composition_html_snapshot_intents[\s\S]*service_role/],
  [commit,/HTML_SNAPSHOT_INTENT_UNCONFIRMED/],
  [commit,/i\.intent#>>'\{identity,projectHash\}' = archive->>'projectHash'/],
  [intents,/stored\.intent IS DISTINCT FROM p_intent/], [intents,/stored\.actor_id IS DISTINCT FROM p_actor/],
  [intents,/native_hash IS DISTINCT FROM p_intent/], [intents,/HTML_SNAPSHOT_CAS_CONFLICT/],
  [intents,/public\.read_html_editing_compilation/g],
  [intents,/ON CONFLICT \(organization_id,operation_id\) DO NOTHING/],
  [intents,/FROM PUBLIC,anon,authenticated/], [intents,/TO service_role/],
];
for (const [source,pattern] of guards) assert.match(source,pattern);
assert.ok(commit.indexOf("video_composition_drafts WHERE") < commit.indexOf("video_compositions WHERE"));
assert.ok(commit.indexOf("html_snapshot_resource_bindings(p_org") < commit.indexOf("INSERT INTO public.video_composition_revisions"));
assert.ok(commit.indexOf("HTML_SNAPSHOT_LINK_CONFLICT") < commit.indexOf("UPDATE public.video_compositions SET"));
assert.ok(commit.indexOf("UPDATE public.video_compositions SET") < commit.indexOf("INSERT INTO private.composition_html_snapshot_operations"));
assert.doesNotMatch(commit,/DELETE FROM|TRUNCATE |storage\.objects/i);
assert.doesNotMatch(reconcile,/INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE |storage\.objects/i);
assert.ok(reconcile.indexOf("video_composition_drafts WHERE") < reconcile.indexOf("video_compositions WHERE"));
const locator = intents.slice(intents.indexOf("CREATE FUNCTION public.read_html_editing_snapshot_intent"));
assert.doesNotMatch(locator,/INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE |storage\.objects/i);
assert.ok(commit.indexOf("HTML_SNAPSHOT_INTENT_UNCONFIRMED") < commit.indexOf("INSERT INTO public.video_composition_revisions"));
console.log(`${guards.length + 9} lexical publication/reconciliation/intent guards passed; SQL runtime not executed.`);

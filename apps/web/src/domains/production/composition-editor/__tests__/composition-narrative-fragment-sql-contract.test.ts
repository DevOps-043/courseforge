import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

// Static contract only; does not parse/execute PostgreSQL or prove locks/RLS/atomicity.
const guard = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261006100000_narrative_fragment_resource_guards.sql"), "utf8");
const captionGuard = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261006110000_narrative_fragment_caption_guard.sql"), "utf8");
const clipGuard = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261006120000_narrative_fragment_clip_guard.sql"), "utf8");
const selectionGuard = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261006130000_narrative_fragment_selection_guard.sql"), "utf8");
const documentGuard = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261006140000_narrative_fragment_document_delta.sql"), "utf8");
const commit = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261006150000_narrative_fragment_atomic_receipts.sql"), "utf8");
test("resource guard is internal, prepared and cannot append or expose Storage", () => {
  assert.match(guard, /PREPARED ONLY/);
  assert.match(guard, /SECURITY DEFINER SET search_path = pg_catalog/);
  assert.match(guard, /REVOKE ALL ON FUNCTION private.validate_narrative_fragment_resources[\s\S]*FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(guard, /GRANT EXECUTE|INSERT INTO|DELETE FROM|append_video|storage_path|storage_bucket/);
});
test("audiovisual receipt commit is scoped/service-only and deduplicates before current-source validation", () => {
  assert.match(commit, /PRIMARY KEY \(organization_id,draft_id,actor_id,command_id\)/);
  assert.match(commit, /ENABLE ROW LEVEL SECURITY/);
  assert.match(commit, /REVOKE ALL ON TABLE public.narrative_fragment_receipts FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(commit, /GRANT EXECUTE ON FUNCTION public.commit_narrative_fragment.*TO service_role/);
  assert.ok(commit.indexOf("SELECT * INTO prior") < commit.indexOf("SELECT * INTO current_doc"));
  assert.match(commit, /FOR UPDATE NOWAIT/);
  assert.match(commit, /'COMMAND_REUSED'/);
  assert.match(commit, /'REPLAYED','receipt',prior.receipt/);
  assert.doesNotMatch(commit, /DROP TABLE|DELETE FROM|commit_narrative_voice_extraction/);
});
test("atomic audiovisual commit validates full delta/resources before native append and inserts multitrack receipt afterward", () => {
  const delta = commit.indexOf("retained := private.narrative_fragment_document_delta");
  const resources = commit.indexOf("resources_status := private.validate_narrative_fragment_resources");
  const append = commit.indexOf("SELECT * INTO appended FROM public.append_video_composition_draft_document_v2");
  const receipt = commit.indexOf("INSERT INTO public.narrative_fragment_receipts");
  assert.ok(delta > 0 && resources > delta && append > resources && receipt > append);
  assert.match(commit, /appended.outcome IS DISTINCT FROM 'APPENDED' THEN RAISE EXCEPTION/);
  assert.match(commit, /'newClipIds',new_ids/);
  assert.match(commit, /'FONT_CHANGED'/);
  assert.match(commit, /EXCEPTION WHEN lock_not_available/);
});
test("document delta validates every retained copy and exact append-only document without persistence", () => {
  assert.match(documentGuard, /private.narrative_fragment_selected_clips/);
  assert.match(documentGuard, /private.validate_narrative_fragment_clip/);
  assert.match(documentGuard, /private.validate_narrative_fragment_caption/);
  assert.match(documentGuard, /copies IS DISTINCT FROM p_plan->'copies'/);
  assert.match(documentGuard, /p_proposed IS DISTINCT FROM expected/);
  assert.match(documentGuard, /\(p_original->'clips'\)\|\|added/);
  assert.match(documentGuard, /RETURN retained/);
  assert.match(documentGuard, /FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(documentGuard, /GRANT EXECUTE|INSERT INTO|UPDATE public|DELETE FROM/);
});
test("document delta creates fresh linked-scene and complete groups without mutating original identities", () => {
  assert.match(documentGuard, /scene_map/);
  assert.match(documentGuard, /NARRATIVE_FRAGMENT_SCENE_COLLISION/);
  assert.match(documentGuard, /NARRATIVE_FRAGMENT_COPY_IDENTITY_INVALID/);
  assert.match(documentGuard, /NARRATIVE_FRAGMENT_GROUP_COPY_INCOMPLETE/);
  assert.match(documentGuard, /NARRATIVE_FRAGMENT_GROUP_COLLISION/);
  assert.match(documentGuard, /ORDER BY member.ordinality/);
  assert.match(documentGuard, /'fragment-group-'\|\|p_command::text/);
});
test("selection guard requires exact unique membership and explicit planner order instead of DB collation", () => {
  assert.match(selectionGuard, /NOT BETWEEN 2 AND 20/);
  assert.match(selectionGuard, /NOT BETWEEN 2 AND 48/);
  assert.match(selectionGuard, /count\(DISTINCT value\)/);
  assert.match(selectionGuard, /NARRATIVE_FRAGMENT_MEMBERSHIP_INVALID/);
  assert.match(selectionGuard, /jsonb_agg\(c ORDER BY selected.ordinality\)/);
  assert.match(selectionGuard, /WITH ORDINALITY selected\(value,ordinality\)/);
  assert.match(selectionGuard, /c->>'startSeconds'\)::numeric<interval_end/);
  assert.match(selectionGuard, /c->>'durationSeconds'\)::numeric>interval_start/);
});
test("selection guard rejects unavailable tracks, effects, ambiguous or incomplete pairs and partial groups", () => {
  for (const reason of ["NARRATIVE_FRAGMENT_TRACK_UNAVAILABLE", "NARRATIVE_FRAGMENT_EFFECT_UNSUPPORTED",
    "NARRATIVE_FRAGMENT_LINK_AMBIGUOUS", "NARRATIVE_FRAGMENT_LINK_INCOMPLETE", "NARRATIVE_FRAGMENT_GROUP_INCOMPLETE",
    "NARRATIVE_FRAGMENT_ANCHOR_OR_VISUAL_INVALID"]) assert.ok(selectionGuard.includes(reason));
  assert.match(selectionGuard, /\{motion,animations\}/);
  assert.match(selectionGuard, /\{transitions,items\}/);
  assert.match(selectionGuard, /jsonb_array_length\(avatars\)>1 OR jsonb_array_length\(voices\)>1/);
  assert.match(selectionGuard, /sourceOffsetSeconds/);
  assert.match(selectionGuard, /FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(selectionGuard, /GRANT EXECUTE|INSERT INTO|UPDATE public|DELETE FROM/);
});
test("clip guard permits only bounded non-destructive copies with deterministic IDs and unchanged fields", () => {
  assert.match(clipGuard, /p_copy-mutable_fields IS DISTINCT FROM p_original-mutable_fields/);
  assert.match(clipGuard, /p_ordinal NOT BETWEEN 0 AND 47/);
  assert.match(clipGuard, /left\(p_original->>'label',85\)/);
  assert.match(clipGuard, /'hf-fragment-'\|\|p_command::text/);
  assert.match(clipGuard, /p_copy->>'timingSource' IS DISTINCT FROM 'USER_EDITED'/);
  assert.match(clipGuard, /FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(clipGuard, /GRANT EXECUTE|INSERT INTO|UPDATE public|DELETE FROM/);
});
test("clip guard validates relative placement/source windows and delegates caption delta without relaxing effects", () => {
  assert.match(clipGuard, /p_destination\+intersection_start-p_start/);
  assert.match(clipGuard, /intersection_end-intersection_start/);
  assert.match(clipGuard, /expected_offset\+intersection_end-intersection_start>p_asset_duration::numeric\/1000/);
  assert.match(clipGuard, /private.validate_narrative_fragment_caption/);
  assert.match(clipGuard, /p_copy->'source' IS DISTINCT FROM p_original->'source'/);
  for (const field of ["hidden", "playbackRate", "freezeTailSeconds", "fadeInSeconds", "fadeOutSeconds"]) assert.ok(clipGuard.includes(field));
  assert.match(clipGuard, /p_copy->'sourceOffsetSeconds' IS NOT DISTINCT FROM p_original->'sourceOffsetSeconds'/);
});
test("caption guard is pure, internal, bounded and cannot mutate the draft", () => {
  assert.match(captionGuard, /PREPARED ONLY/);
  assert.match(captionGuard, /IMMUTABLE SET search_path = pg_catalog/);
  assert.match(captionGuard, /NOT BETWEEN 1 AND 2000/);
  assert.match(captionGuard, /jsonb_array_length\(cue->'words'\)>20/);
  assert.match(captionGuard, /FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(captionGuard, /GRANT EXECUTE|INSERT INTO|UPDATE public|DELETE FROM/);
});
test("caption guard preserves authored fields and requires exact retained cue/word counts and command IDs", () => {
  assert.match(captionGuard, /p_copy-'cues' IS DISTINCT FROM p_source-'cues'/);
  assert.match(captionGuard, /copied_cue-ARRAY\['id','startSeconds','endSeconds','words'\]/);
  assert.match(captionGuard, /copied_word-ARRAY\['id','startSeconds','endSeconds'\]/);
  assert.match(captionGuard, /jsonb_array_length\(copied_cue->'words'\)<>word_count/);
  assert.match(captionGuard, /jsonb_array_length\(p_copy->'cues'\)=cue_count/);
  assert.match(captionGuard, /IF cue_count=0 THEN RETURN p_copy IS NULL/);
  assert.match(captionGuard, /p_command::text\|\|'-'\|\|p_clip_ordinal::text/);
});
test("caption guard applies exclusive-end intersections and bounds floating-point tolerance", () => {
  assert.match(captionGuard, /IF cue_end<=cue_start THEN CONTINUE/);
  assert.match(captionGuard, /IF word_end<=word_start THEN CONTINUE/);
  assert.match(captionGuard, /time_tolerance CONSTANT numeric := 0.000001/);
  assert.match(captionGuard, /cue_start-p_start/);
  assert.match(captionGuard, /word_start-p_start/);
  assert.match(captionGuard, /ELSIF copied_cue \? 'words' THEN RETURN false/);
});
test("resource guard bounds manifest and locks only exact tenant/component/draft links in stable order", () => {
  assert.match(guard, /jsonb_array_length\(p_clips\) NOT BETWEEN 2 AND 48/);
  assert.match(guard, /jsonb_array_length\(p_plan->'fontBindings'\)>32/);
  assert.match(guard, /a.organization_id=p_org AND a.material_component_id=p_component AND l.organization_id=p_org AND l.draft_id=p_draft/);
  assert.match(guard, /ORDER BY a.id FOR SHARE OF a,l NOWAIT/);
  assert.match(guard, /ORDER BY f.id FOR SHARE NOWAIT/);
  assert.match(guard, /count\(DISTINCT e->>'assetId'\)/);
  assert.match(guard, /NARRATIVE_FRAGMENT_ASSET_SET_INVALID/);
  assert.doesNotMatch(guard, /EXCEPTION WHEN lock_not_available/);
});
test("resource guard binds registry, anchor timestamps and uploaded font identity with explicit failures", () => {
  for (const contract of ["asset.checksum IS DISTINCT FROM supplied->>'checksum'", "asset.qa_status IS DISTINCT FROM supplied->>'qaStatus'",
    "asset.duration_milliseconds IS DISTINCT FROM", "source_end>asset.duration_milliseconds::numeric/1000",
    "scene->'wordTimestamps' IS DISTINCT FROM asset.metadata->'word_timestamps'", "font.source IS DISTINCT FROM 'uploaded'",
    "font.status IS DISTINCT FROM 'READY'", "font.checksum_sha256 IS DISTINCT FROM supplied->>'checksumSha256'",
    "font.family IS DISTINCT FROM supplied->>'family'", "font.mime_type IS DISTINCT FROM supplied->>'mimeType'",
    "font.file_size_bytes IS DISTINCT FROM", "'{source,style,fontFamily}' IS DISTINCT FROM font.family",
    "RETURN 'ASSET_CHANGED'", "RETURN 'FONT_CHANGED'"]) assert.ok(guard.includes(contract), contract);
});

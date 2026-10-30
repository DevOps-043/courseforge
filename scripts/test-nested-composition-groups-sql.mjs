import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// PostgreSQL descartable en memoria; nunca consulta .env ni bases remotas.
const runtime = process.env.NESTED_GROUPS_PGLITE_PATH || ".tmp/sql-verification/node_modules/@electric-sql/pglite/dist/index.js";
const { PGlite } = await import(pathToFileURL(resolve(runtime)).href);
const database = new PGlite();
const fixtures = JSON.parse(await readFile("apps/web/src/domains/production/composition-editor/__tests__/fixtures/composition-group-graphs.json", "utf8"));
const compiled = "apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/";
const load = name => import(pathToFileURL(resolve(compiled + name + ".js")).href);
const { createNarrativeDocumentFixture } = await load("__tests__/fixtures/composition-narrative.fixture");
const { deriveNarrativeNavigationOccurrences } = await load("composition-narrative-occurrence.service");
const { buildNarrativeFragmentPlan } = await load("composition-narrative-fragment.service");
const { applyCompositionEditorPatches } = await load("editor-patch.service");
const { validateCompositionGroupGraph } = await load("composition-group-hierarchy");
const org = "20000000-0000-4000-8000-000000000001";
const draft = "10000000-0000-4000-8000-000000000001";
const actor = "30000000-0000-4000-8000-000000000001";

await database.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA private;
  CREATE TABLE video_composition_drafts(id uuid PRIMARY KEY,organization_id uuid,state text,current_version integer,last_changed_by uuid,updated_at timestamptz);
  CREATE TABLE video_composition_draft_documents(draft_id uuid,organization_id uuid,version integer,format text,document jsonb,document_hash text,created_by uuid,UNIQUE(draft_id,version));
  CREATE TABLE video_composition_draft_changes(draft_id uuid,organization_id uuid,version integer,actor_id uuid,source text,summary text,metadata jsonb);
  INSERT INTO video_composition_drafts VALUES('${draft}','${org}','ACTIVE',1,NULL,NULL);
`);
for (const migration of ["20260815010000_replace_composition_document_append_rpc.sql", "20261006110000_narrative_fragment_caption_guard.sql", "20261006120000_narrative_fragment_clip_guard.sql",
  "20261029230000_nested_composition_groups.sql", "20261029230100_nested_narrative_fragment_groups.sql"]) {
  await database.exec(await readFile("supabase/migrations/" + migration, "utf8"));
}
const query = (sql, args = []) => database.query(sql, args);
const validate = document => query("SELECT private.assert_composition_group_graph($1::jsonb)", [JSON.stringify(document)]);

await test("fixtures compartidos coinciden en TypeScript y PostgreSQL", async () => {
  for (const fixture of fixtures) {
    const document = fixture.document;
    assert.equal(validateCompositionGroupGraph(document.groups, new Set(document.clips.map(clip => clip.id)), document.groupingVersion).length === 0, fixture.valid);
    if (fixture.valid) await validate(document);
    else await assert.rejects(validate(document), /COMPOSITION_GROUP/);
  }
});

await test("profundidad SQL admite ocho niveles y rechaza nueve", async () => {
  const make = depth => ({ groupingVersion: 2, clips: Array.from({ length: 10 }, (_, i) => ({ id: `clip-${i}` })),
    groups: Array.from({ length: depth }, (_, i) => ({ id: `group-${i}`, order: i,
      clipIds: i === depth - 1 ? [`clip-${i}`, `clip-${i + 1}`] : [`clip-${i}`],
      ...(i < depth - 1 ? { childGroupIds: [`group-${i + 1}`] } : {}) })) });
  await validate(make(8)); await assert.rejects(validate(make(9)), /DEPTH_OR_CYCLE/);
});

await test("SQL conserva los máximos de 250 grupos y 500 clips", async () => {
  const clips = Array.from({ length: 500 }, (_, i) => ({ id: `clip-${i}` }));
  const leaves = Array.from({ length: 249 }, (_, i) => ({ id: `group-${i}`, order: i, clipIds: [`clip-${i * 2}`, `clip-${i * 2 + 1}`] }));
  const maximum = { groupingVersion: 2, clips, groups: [...leaves, { id: "group-root", order: 249, clipIds: [], childGroupIds: leaves.map(group => group.id) }] };
  await validate(maximum);
  await assert.rejects(validate({ ...maximum, clips: [...clips, { id: "clip-extra" }] }), /GRAPH_INVALID/);
  await assert.rejects(validate({ ...maximum, groups: [...maximum.groups, { id: "group-extra", order: 250, clipIds: ["clip-498", "clip-499"] }] }), /GRAPH_INVALID/);
});

await test("guard protege append, wrapper y escritura directa; conflicto no altera documento", async () => {
  const initial = fixtures[0].document;
  await query("INSERT INTO video_composition_draft_documents VALUES($1,$2,1,'test',$3::jsonb,$4,$5)", [draft, org, JSON.stringify(initial), "a".repeat(64), actor]);
  const nested = fixtures[1].document;
  const append = (expected, doc, hash, organization = org) => query("SELECT * FROM public.append_video_composition_draft_document_v2($1,$2,$3,$4::jsonb,$5,'test',$6,'USER','Prueba local','{}')", [draft, organization, expected, JSON.stringify(doc), hash, actor]);
  assert.equal((await append("a".repeat(64), nested, "b".repeat(64))).rows[0].outcome, "APPENDED");
  assert.equal((await append("a".repeat(64), nested, "c".repeat(64))).rows[0].outcome, "CONFLICT");
  assert.equal((await append("b".repeat(64), nested, "c".repeat(64), actor)).rows[0].outcome, "NOT_EDITABLE");
  await assert.rejects(append("b".repeat(64), initial, "c".repeat(64)), /DOWNGRADE/);
  await assert.rejects(query("SELECT * FROM public.append_video_composition_draft_document($1,$2,$3,$4::jsonb,$5,'test',$6,'USER','Prueba wrapper','{}')", [draft, org, "b".repeat(64), JSON.stringify(initial), "c".repeat(64), actor]), /DOWNGRADE/);
  await assert.rejects(query("INSERT INTO video_composition_draft_documents VALUES($1,$2,3,'test',$3::jsonb,$4,$5)", [draft, org, JSON.stringify(initial), "c".repeat(64), actor]), /DOWNGRADE/);
  const history = await query("SELECT version FROM video_composition_draft_documents ORDER BY version");
  assert.deepEqual(history.rows.map(row => row.version), [1, 2]);
});

function fragmentFixture() {
  const document = createNarrativeDocumentFixture();
  const visualId = "22222222-2222-4222-8222-222222222222";
  const organizationId = "33333333-3333-4333-8333-333333333333";
  const componentId = "44444444-4444-4444-8444-444444444444";
  document.tracks.push({ id: "visual", kind: "VISUAL", label: "Visual", locked: false, order: 1, semanticRole: "BROLL" });
  for (let index = 1; index <= 3; index++) document.clips.push({ ...structuredClone(document.clips[0]), id: `visual-${index}`, hfId: `hf-visual-${index}`,
    kind: "VIDEO", trackId: "visual", label: "Visual", startSeconds: 10.5, durationSeconds: 1.5, sourceOffsetSeconds: 2, sceneId: undefined,
    source: { type: "PRODUCTION_ASSET", productionAssetId: visualId, hasAudio: false } });
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0];
  const shared = { organization_id: organizationId, material_component_id: componentId, checksum: "c".repeat(64), qa_status: "APPROVED", duration_milliseconds: 10_000 };
  const registryAssets = new Map([
    [occurrence.assetId, { ...shared, id: occurrence.assetId, asset_type: "VOICE_AUDIO", mime_type: "audio/mpeg", metadata: { script_hash: occurrence.scriptHash, word_timestamps: document.narrativeScenes[0].wordTimestamps } }],
    [visualId, { ...shared, id: visualId, asset_type: "SOURCE_MEDIA", mime_type: "video/mp4" }],
  ]);
  const grouped = applyCompositionEditorPatches(document, [
    { type: "group.create", groupId: "group-a", clipIds: ["voice-1", "visual-1"] },
    { type: "group.create", groupId: "group-b", clipIds: ["visual-2", "visual-3"] },
    { type: "group.create", groupId: "group-root", clipIds: [], childGroupIds: ["group-a", "group-b"] },
  ]);
  return { document: grouped, documentHash: "b".repeat(64), organizationId, componentId, commandId: "55555555-5555-4555-8555-555555555555",
    selection: { documentHash: "b".repeat(64), occurrenceId: occurrence.id, firstSourceIndex: 1, lastSourceIndex: 2 },
    selectedTrackIds: ["voice", "visual"], linkedAssetIds: [...registryAssets.keys()], registryAssets };
}

await test("delta narrativo SQL coincide con copia jerárquica TypeScript y rechaza pérdidas", async () => {
  const params = fragmentFixture(); const planned = buildNarrativeFragmentPlan(params); assert.ok(planned.ok);
  const next = applyCompositionEditorPatches(params.document, planned.plan.operations);
  const delta = proposed => query("SELECT private.narrative_fragment_document_delta($1::jsonb,$2::jsonb,$3::jsonb,$4::uuid)", [JSON.stringify(params.document), JSON.stringify(planned.plan), JSON.stringify(proposed), params.commandId]);
  await delta(next);
  const flattened = structuredClone(next); flattened.groups = flattened.groups.filter(group => !group.childGroupIds?.length);
  await assert.rejects(delta(flattened), /DELTA_INVALID/);
  const partial = structuredClone(planned.plan); partial.candidateClipIds = partial.candidateClipIds.filter(id => id !== "visual-3");
  await assert.rejects(query("SELECT private.narrative_fragment_selected_clips($1::jsonb,$2::jsonb)", [JSON.stringify(params.document), JSON.stringify(partial)]));
});

await test("capacidad publicada después de guards y helpers privados sin permisos runtime", async () => {
  const result = await query("SELECT public.composition_grouping_capabilities() AS capabilities");
  assert.equal(result.rows[0].capabilities.contract, "nested-composition-groups-v2");
  for (const role of ["anon", "authenticated", "service_role"]) {
    const permission = await query("SELECT has_function_privilege($1,'private.assert_composition_group_graph(jsonb)','EXECUTE') AS allowed", [role]);
    assert.equal(permission.rows[0].allowed, false);
  }
  await database.exec("SET ROLE authenticated");
  await assert.rejects(query("SELECT public.composition_grouping_capabilities()"), /permission denied/);
  await database.exec("RESET ROLE");
});
await database.close();

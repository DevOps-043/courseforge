import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run after compiling tsconfig.hyperframes-test.json. Real producer/compiler
// inputs and real SQL functions; minimal relational fixtures, no remote DB.
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url);
const built = path.join(root, 'apps/web/.tmp/hyperframes-tests/domains/production');
const { generatedDeckIntegrationFixture } = require(path.join(built, 'slides/__tests__/generated-deck-integration-fixture.js'));
const { readGeneratedCourseDeckEditorial } = require(path.join(built, 'slides/generation/course-deck-editorial-reader.server.js'));
const { createInitialCompositionDocument } = require(path.join(built, 'composition-editor/composition-document.factory.js'));
const { generatedDeckInitialSource, instantiateGeneratedDeckDocument } = require(path.join(built, 'composition-editor/composition-generated-deck-import.server.js'));
const { hashCompositionDocument } = require(path.join(built, 'composition-editor/composition-document.service.js'));
const { prepareGeneratedDeckInitializations, computeGeneratedDeckInitializationRequestSha256 } = require(path.join(built, 'composition-editor/composition-generated-deck-initialization.server.js'));
const { prepareHtmlEditingRevisionCommand } = require(path.join(built, 'composition-editor/html-editing/html-editing-revision.server.js'));
const { bindHtmlEditingRevisionToComposition } = require(path.join(built, 'composition-editor/composition-html-editing-document.server.js'));
const { generatedDeckInitializationReceiptSchema } = require(path.join(built, 'composition-editor/composition-generated-deck-initialization.contract.js'));
const runtime = process.env.GENERATED_DECK_TEST_PGLITE_PATH
  || path.join(root, 'apps/web/.tmp/syllabus-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(runtime).href);
const files = [
  '20260815010000_replace_composition_document_append_rpc.sql',
  '20261005200000_html_editing_revision_store.sql',
  '20261005220000_read_exact_html_editing_compilation.sql',
  '20261006000000_html_snapshot_resource_validation.sql',
  '20261006050000_html_editing_bootstrap_registration.sql',
  '20261006060000_read_html_editing_bootstrap_context.sql',
  '20261010210000_google_font_candidate_bundles.sql',
  '20261010220000_google_font_native_admission.sql',
  '20261010230000_google_font_native_face_read.sql',
  '20261011000000_google_font_html_resource_bindings.sql',
  '20261011010000_generated_deck_initialization.sql',
];
const migrations = await Promise.all(files.map(file => readFile(path.join(root, 'supabase/migrations', file), 'utf8')));
const operation = '00000000-0000-4000-8000-000000000099';
const signature = 'public.commit_generated_deck_initialization(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,text,jsonb)';

async function fixture(withImage = false) {
  const source = generatedDeckIntegrationFixture(withImage), db = new PGlite();
  try {
    const generated = await readGeneratedCourseDeckEditorial({ ...source, supabase: source.client });
    const initial = createInitialCompositionDocument({ animatedDeck: generatedDeckInitialSource(generated), assets: [],
      plan: { title: 'Curso', subtitle: 'Prueba', accentColor: '#00aabb', durationSeconds: 20 } });
    initial.clips.push({ ...structuredClone(initial.clips[0]), id: 'repeat-slide', hfId: 'repeat-slide' });
    const document = instantiateGeneratedDeckDocument(initial, generated);
    const owner = { actorId: source.organizationId, organizationId: source.organizationId, draftId: source.draftId };
    const context = { revisionId: source.compositionId, documentHash: hashCompositionDocument(document), grantedAssetIds: withImage ? [source.imageId] : [] };
    const prepared = prepareGeneratedDeckInitializations({ owner, context, document, generated });
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA storage; CREATE SCHEMA private;
      CREATE TABLE public.organizations(id uuid PRIMARY KEY,is_active boolean);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_active boolean);
      CREATE TABLE public.organization_user_roles(organization_id uuid,user_id uuid,platform_role text);
      CREATE TABLE public.video_compositions(id uuid PRIMARY KEY,organization_id uuid,active_revision_id uuid,material_component_id uuid);
      CREATE TABLE public.video_composition_revisions(id uuid PRIMARY KEY,organization_id uuid,composition_id uuid);
      CREATE TABLE public.video_composition_drafts(id uuid PRIMARY KEY,organization_id uuid,composition_id uuid,state text,current_version integer,last_changed_by uuid,updated_at timestamptz);
      CREATE TABLE public.video_composition_draft_documents(id uuid DEFAULT gen_random_uuid(),draft_id uuid,organization_id uuid,version integer,format text,document jsonb,document_hash text,created_by uuid,PRIMARY KEY(draft_id,version));
      CREATE TABLE public.video_composition_draft_changes(draft_id uuid,organization_id uuid,version integer,actor_id uuid,source text,summary text,metadata jsonb);
      CREATE TABLE public.production_assets(id uuid PRIMARY KEY,organization_id uuid,qa_status text,checksum text,file_size_bytes bigint,mime_type text,storage_bucket text,storage_path text);
      CREATE TABLE public.video_composition_draft_assets(production_asset_id uuid,organization_id uuid,draft_id uuid);
      CREATE TABLE public.organization_assembly_assets(id uuid,organization_id uuid,status text,checksum text,file_size_bytes bigint,mime_type text,storage_bucket text,storage_path text);
      CREATE TABLE public.video_composition_draft_branding(intro_asset_id uuid,outro_asset_id uuid,organization_id uuid,draft_id uuid);
      CREATE TABLE public.sound_effect_assets(id uuid,organization_id uuid,status text,checksum_sha256 text,file_size_bytes bigint,mime_type text,storage_bucket text,storage_path text);
      CREATE TABLE public.video_composition_draft_sound_effect_assets(sound_effect_asset_id uuid,organization_id uuid,draft_id uuid);
      CREATE TABLE public.organization_slide_fonts(id uuid PRIMARY KEY,organization_id uuid,family text,source text,status text,css_url text,checksum_sha256 text,file_size_bytes bigint,mime_type text,storage_bucket text,storage_path text);
      CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb,PRIMARY KEY(bucket_id,name));`);
    await db.query('INSERT INTO public.organizations VALUES($1,true)', [source.organizationId]);
    await db.query('INSERT INTO public.profiles VALUES($1,true)', [owner.actorId]);
    await db.query("INSERT INTO public.organization_user_roles VALUES($1,$2,'ADMIN')", [source.organizationId, owner.actorId]);
    await db.query('INSERT INTO public.video_compositions VALUES($1,$2,$1,$3)', [source.compositionId, source.organizationId, source.componentId]);
    await db.query('INSERT INTO public.video_composition_revisions VALUES($1,$2,$1)', [source.compositionId, source.organizationId]);
    await db.query("INSERT INTO public.video_composition_drafts VALUES($1,$2,$3,'ACTIVE',1,NULL,now())", [source.draftId, source.organizationId, source.compositionId]);
    await db.query('INSERT INTO public.video_composition_draft_documents(draft_id,organization_id,version,format,document,document_hash,created_by) VALUES($1,$2,1,$3,$4,$5,$2)',
      [source.draftId, source.organizationId, document.format, JSON.stringify(document), context.documentHash]);
    if (withImage) {
      await db.query("INSERT INTO public.production_assets VALUES($1,$2,'APPROVED',$3,48,'image/png','production-assets','image.png')", [source.imageId, source.organizationId, 'a'.repeat(64)]);
      await db.query('INSERT INTO public.video_composition_draft_assets VALUES($1,$2,$3)', [source.imageId, source.organizationId, source.draftId]);
    }
    for (const sql of migrations) await db.exec(sql);
    const requestHash = computeGeneratedDeckInitializationRequestSha256(context.documentHash);
    const parameters = [source.organizationId, source.draftId, owner.actorId, operation, requestHash, context.documentHash,
      JSON.stringify(prepared.registrations), JSON.stringify(prepared.document), prepared.documentHash, '[]'];
    const commit = async (args = parameters) => (await db.query('SELECT public.commit_generated_deck_initialization($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS receipt', args)).rows[0].receipt;
    const read = async (actor = owner.actorId, org = source.organizationId) => (await db.query('SELECT public.read_generated_deck_initialization_operation($1,$2,$3,$4) AS result', [org, source.draftId, actor, operation])).rows[0].result;
    const counts = async () => (await db.query(`SELECT
      (SELECT count(*)::integer FROM private.composition_html_templates) AS templates,
      (SELECT count(*)::integer FROM private.composition_html_revisions) AS revisions,
      (SELECT count(*)::integer FROM public.video_composition_draft_documents) AS documents,
      (SELECT count(*)::integer FROM public.video_composition_draft_changes) AS changes,
      (SELECT count(*)::integer FROM private.composition_generated_deck_initializations) AS receipts`)).rows[0];
    return { db, source, generated, owner, document, context, prepared, parameters, commit, read, counts };
  } catch (error) { await db.close(); throw error; }
}

test('complete migration compiles; only service RPCs, no direct receipt access or browser grants', async () => {
  const { db, source, owner, context, document } = await fixture();
  try {
    const row = (await db.query(`SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,
      has_function_privilege('authenticated',$1,'EXECUTE') AS browser,has_function_privilege('service_role',$1,'EXECUTE') AS server,
      has_table_privilege('service_role','private.composition_generated_deck_initializations','INSERT') AS direct,
      (SELECT relrowsecurity FROM pg_class WHERE oid='private.composition_generated_deck_initializations'::regclass) AS rls`, [signature])).rows[0];
    assert.deepEqual(row, { anon: false, browser: false, server: true, direct: false, rls: true });
    const before = (await db.query('SELECT public.read_generated_deck_initialization_context($1,$2,$3,$4) AS context',
      [source.organizationId, source.draftId, owner.actorId, context.documentHash])).rows[0].context;
    assert.deepEqual(before.document, document);
    assert.equal(before.documentVersion, 1);
    assert.equal(before.componentId, source.componentId);
  } finally { await db.close(); }
});

test('real generated deck registers all initial v1 pointers with exactly one native save/audit/receipt and replay never writes', async () => {
  const fixtureState = await fixture(true), { db, commit, read, counts, prepared, document, source } = fixtureState;
  try {
    assert.deepEqual(await read(), { status: 'NOT_FOUND' });
    await db.exec('SET ROLE service_role');
    const receipt = generatedDeckInitializationReceiptSchema.parse(await commit());
    assert.equal(receipt.documentHash, prepared.documentHash);
    assert.deepEqual(receipt.items.map(({ created, ...item }) => item), prepared.references);
    assert.ok(receipt.items.every(item => item.created));
    assert.deepEqual(await read(), { status: 'RECORDED', receipt });
    assert.deepEqual(await commit(), receipt);
    await db.exec('RESET ROLE');
    assert.deepEqual(await counts(), { templates: prepared.references.length, revisions: prepared.references.length, documents: 2, changes: 1, receipts: 1 });
    const saved = (await db.query('SELECT document FROM public.video_composition_draft_documents ORDER BY version DESC LIMIT 1')).rows[0].document;
    assert.deepEqual(saved.clips, document.clips);
    assert.equal((await db.query('SELECT active_revision_id FROM public.video_compositions WHERE id=$1', [source.compositionId])).rows[0].active_revision_id, source.compositionId);
    await db.exec("UPDATE public.video_composition_draft_documents SET document_hash=repeat('b',64) WHERE version=2");
    assert.deepEqual(await commit(), receipt); // historical replay is not restoration.
    assert.deepEqual(await counts(), { templates: prepared.references.length, revisions: prepared.references.length, documents: 2, changes: 1, receipts: 1 });
  } finally { await db.close(); }
});

test('failure on the last registration rolls back earlier registrations, native save, audit and receipt', async () => {
  const { db, commit, counts, prepared, parameters } = await fixture(true);
  try {
    const changed = structuredClone(prepared.registrations);
    changed.at(-1).revision.sourceHtml += '<p>Invalid final source</p>';
    const args = [...parameters]; args[6] = JSON.stringify(changed);
    await assert.rejects(commit(args), /HTML_EDITING_TEMPLATE_INVALID/);
    assert.deepEqual(await counts(), { templates: 0, revisions: 0, documents: 1, changes: 0, receipts: 0 });
  } finally { await db.close(); }
});

test('receipt storage failure after native append rolls back the entire operation', async () => {
  const { db, commit, counts } = await fixture();
  try {
    await db.exec("CREATE FUNCTION private.deny_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_RECEIPT_UNAVAILABLE'; END $$; CREATE TRIGGER deny_test_receipt BEFORE INSERT ON private.composition_generated_deck_initializations FOR EACH ROW EXECUTE FUNCTION private.deny_test_receipt();");
    await assert.rejects(commit(), /TEST_RECEIPT_UNAVAILABLE/);
    assert.deepEqual(await counts(), { templates: 0, revisions: 0, documents: 1, changes: 0, receipts: 0 });
  } finally { await db.close(); }
});

test('missing/duplicate/extra clips and an altered native layout cannot partially prepare a deck', async () => {
  const { db, commit, counts, prepared, parameters } = await fixture();
  try {
    for (const registrations of [prepared.registrations.slice(1), [...prepared.registrations, prepared.registrations[0]],
      [...prepared.registrations, { ...prepared.registrations[0], clipId: 'foreign-clip' }]]) {
      const args = [...parameters]; args[6] = JSON.stringify(registrations);
      await assert.rejects(commit(args), /GENERATED_DECK_INITIALIZATION_(CLIP_SET_INVALID|INVALID)/);
    }
    const changed = structuredClone(prepared.document); changed.clips[0].layout.x += 1;
    const args = [...parameters]; args[7] = JSON.stringify(changed); args[8] = hashCompositionDocument(changed);
    await assert.rejects(commit(args), /DOCUMENT_INVALID/);
    assert.deepEqual(await counts(), { templates: 0, revisions: 0, documents: 1, changes: 0, receipts: 0 });
  } finally { await db.close(); }
});

test('current actor/tenant/draft/CAS/anchor/image grants are required, not previous UI permission', async () => {
  const { db, commit, counts, parameters, source } = await fixture(true);
  try {
    const wrongDigest = [...parameters]; wrongDigest[4] = 'b'.repeat(64);
    await assert.rejects(commit(wrongDigest), /INITIALIZATION_INVALID/);
    const wrongTenant = [...parameters]; wrongTenant[0] = source.imageId;
    await assert.rejects(commit(wrongTenant), /DRAFT_INVALID/);
    await db.exec("UPDATE public.organization_user_roles SET platform_role='BUILDER'");
    await assert.rejects(commit(), /ACTOR_FORBIDDEN/);
    await db.exec("UPDATE public.organization_user_roles SET platform_role='ADMIN'; UPDATE public.video_composition_drafts SET state='CLOSED'");
    await assert.rejects(commit(), /DRAFT_INVALID/);
    await db.exec("UPDATE public.video_composition_drafts SET state='ACTIVE'; UPDATE public.video_composition_draft_documents SET document_hash=repeat('c',64)");
    await assert.rejects(commit(), /REVISION_CONFLICT/);
    await db.query('UPDATE public.video_composition_draft_documents SET document_hash=$1', [parameters[5]]);
    await db.exec('UPDATE public.video_compositions SET active_revision_id=NULL');
    await assert.rejects(commit(), /TEMPLATE_INVALID/);
    await db.query('UPDATE public.video_compositions SET active_revision_id=$1', [source.compositionId]);
    await db.exec('DELETE FROM public.video_composition_draft_assets');
    await assert.rejects(commit(), /ASSET_NOT_AUTHORIZED/);
    assert.deepEqual(await counts(), { templates: 0, revisions: 0, documents: 1, changes: 0, receipts: 0 });
  } finally { await db.close(); }
});

test('revoked templates deny historical receipt access; reused operation identity cannot reinitialize', async () => {
  const { db, commit, read, parameters, prepared } = await fixture();
  try {
    await commit();
    const changed = [...parameters]; changed[5] = 'a'.repeat(64); changed[4] = computeGeneratedDeckInitializationRequestSha256(changed[5]);
    await assert.rejects(commit(changed), /ID_REUSED/);
    await db.query('UPDATE private.composition_html_templates SET revoked=true WHERE clip_id=$1', [prepared.references[0].clipId]);
    await assert.rejects(read(), /TEMPLATE_INVALID/);
    await assert.rejects(commit(), /TEMPLATE_INVALID/);
  } finally { await db.close(); }
});

test('current font guard failure aborts the operation before any registration', async () => {
  const { db, commit, parameters, counts, source } = await fixture();
  try {
    const args = [...parameters]; args[9] = JSON.stringify([{ fontAssetId: source.imageId, family: 'Missing', checksumSha256: 'd'.repeat(64), fileSizeBytes:48, mimeType:'font/woff2' }]);
    await assert.rejects(commit(args), /HTML_SNAPSHOT_FONT_FORBIDDEN/);
    assert.deepEqual(await counts(), { templates: 0, revisions: 0, documents: 1, changes: 0, receipts: 0 });
  } finally { await db.close(); }
});

test('an authored neighbour is kept exactly; only remaining clips are initialized in one native append', async () => {
  const { db, commit, counts, prepared, source, owner, generated, context, document, parameters } = await fixture();
  try {
    const first = prepared.registrations[0], authority = prepared.revisions[0];
    await db.query('SELECT public.register_html_editing_template_v2($1,$2,$3,$4,$5,$6,$7,$8)',
      [source.organizationId, source.draftId, owner.actorId, first.clipId, context.documentHash,
        JSON.stringify(first.revision), first.revisionSha256, first.usedAssetIds]);
    const text = first.revision.manifest.elements.find(element => element.kind === 'TEXT');
    const edited = prepareHtmlEditingRevisionCommand({ ...authority, expected: { version: 1, sha256: first.revisionSha256 },
      encodedCommand: JSON.stringify({ format: 'courseforge-html-editable-command-v1', binding: authority.authoritativeBinding,
        overrides: [{ operation: 'SET_TEXT', elementId: text.elementId, value: 'Contenido editado antes del lote' }] }) }).next;
    const bound = bindHtmlEditingRevisionToComposition({ ...authority, document, revision: edited.revision, revisionSha256: edited.sha256 });
    // Exercise the actual authoring append as well, not handwritten history rows.
    await db.exec(await readFile(path.join(root, 'supabase/migrations/20261005210000_append_html_editing_native_document.sql'), 'utf8'));
    await db.query('SELECT public.append_html_editing_revision($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [source.organizationId, source.draftId, first.clipId, owner.actorId, 1, first.revisionSha256, context.documentHash,
        JSON.stringify(authority.authoritativeBinding), JSON.stringify(edited.revision), edited.sha256,
        JSON.stringify(bound.document), bound.documentHash, JSON.stringify(edited.compiled.usedAssetIds), 'COMMAND']);
    const remaining = prepareGeneratedDeckInitializations({ owner, generated, document: bound.document,
      context: { ...context, documentHash: bound.documentHash } });
    const args = [...parameters]; args[4] = computeGeneratedDeckInitializationRequestSha256(bound.documentHash);
    args[5] = bound.documentHash; args[6] = JSON.stringify(remaining.registrations); args[7] = JSON.stringify(remaining.document); args[8] = remaining.documentHash;
    const receipt = generatedDeckInitializationReceiptSchema.parse(await commit(args));
    assert.equal(receipt.documentVersion, 3);
    assert.equal(receipt.items.length, prepared.references.length - 1);
    const current = (await db.query('SELECT document FROM public.video_composition_draft_documents ORDER BY version DESC LIMIT 1')).rows[0].document;
    assert.deepEqual(current.htmlEditing.items.find(item => item.clipId === first.clipId), bound.document.htmlEditing.items[0]);
    const latest = (await db.query('SELECT revision FROM private.composition_html_revisions WHERE clip_id=$1 ORDER BY version DESC LIMIT 1', [first.clipId])).rows[0].revision;
    assert.deepEqual(latest, edited.revision);
    assert.deepEqual(await counts(), { templates: prepared.references.length, revisions: prepared.references.length + 1, documents: 3, changes: 2, receipts: 1 });
  } finally { await db.close(); }
});

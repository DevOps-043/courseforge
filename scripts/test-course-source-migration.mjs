import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

// PostgreSQL aislado; reutiliza el runtime temporal existente, sin .env ni red.
const runtime = resolve(process.env.COURSE_SOURCES_PGLITE_PATH || 'apps/web/.tmp/syllabus-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(runtime).href);
const migration = await readFile('supabase/migrations/20261105010000_course_owned_document_sources.sql', 'utf8');
const organization = '10000000-0000-4000-8000-000000000001';
const actor = '20000000-0000-4000-8000-000000000001';
const otherActor = '20000000-0000-4000-8000-000000000002';
const key = '30000000-0000-4000-8000-000000000001';
const otherOrganization = '10000000-0000-4000-8000-000000000002';
let sequence = 10;
const identifier = () => `40000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;

async function database(generation = false) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table profiles(id uuid primary key);
    create table artifacts(id uuid primary key, organization_id uuid not null, created_by uuid references profiles(id),
      idea_central text not null, course_id text, state text not null default 'DRAFT',production_complete boolean default false,generation_metadata jsonb default '{}',nombres jsonb default '[]',objetivos jsonb default '[]',descripcion jsonb default '{}',validation_report jsonb default '{}');
    create table syllabus(artifact_id uuid primary key references artifacts(id),modules jsonb default '[]',state text default 'STEP_DRAFT',upstream_dirty boolean default false,upstream_dirty_source text);
    create table instructional_plans(artifact_id uuid primary key references artifacts(id),lesson_plans jsonb default '[]',state text default 'STEP_DRAFT',upstream_dirty boolean default false,upstream_dirty_source text);
    create table curation(id uuid primary key default gen_random_uuid(),artifact_id uuid unique references artifacts(id),state text default 'PHASE2_DRAFT',attempt_number integer default 1,qa_decision jsonb,upstream_dirty boolean default false,upstream_dirty_source text);
    create table curation_rows(id uuid primary key default gen_random_uuid(),curation_id uuid references curation(id),lesson_id text,apta boolean,source_ref text,validation_report jsonb);
    create table materials(id uuid primary key default gen_random_uuid(),artifact_id uuid unique references artifacts(id),state text default 'PHASE3_DRAFT',version integer default 1,upstream_dirty boolean default false,upstream_dirty_source text);
    create table publication_requests(artifact_id uuid primary key references artifacts(id),status text default 'DRAFT',upstream_dirty boolean default false,upstream_dirty_source text);
    create table material_lessons(id uuid primary key default gen_random_uuid(),materials_id uuid references materials(id),lesson_id text);
    create table material_components(id uuid primary key default gen_random_uuid(),material_lesson_id uuid references material_lessons(id),content jsonb,assets jsonb default '{}');
    grant select,insert,update on material_lessons,material_components to service_role;
    grant select,insert,update on artifacts,syllabus,instructional_plans,curation,curation_rows,materials,publication_requests to service_role;
    grant delete on curation_rows to service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create policy historical_permissive on storage.objects for all to anon,authenticated using(true) with check(true);
    grant usage on schema storage to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
    grant usage on schema public to service_role,anon,authenticated;
    grant select,insert on artifacts to service_role;
    insert into profiles values ('${actor}'),('${otherActor}');`);
  await db.exec(migration);
  await db.exec(await readFile('supabase/migrations/20261106010000_course_source_extraction.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261106020000_course_source_lifecycle.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261106030000_course_source_policy_review.sql', 'utf8'));
  if (generation) {
    await db.exec(`alter table syllabus add column content_version integer default 0;
      alter table curation add column syllabus_content_version integer default 0;
      create table production_jobs(id uuid primary key default gen_random_uuid(),artifact_id uuid,material_component_id uuid,status text default 'PENDING',input_snapshot jsonb default '{}');
      create table production_assets(id uuid primary key default gen_random_uuid(),artifact_id uuid,material_component_id uuid,production_job_id uuid);
      create table course_delivery_workspaces(artifact_id uuid primary key,document jsonb,revision integer default 0);
      create table course_delivery_runs(id uuid primary key,artifact_id uuid,operation text);
      grant select,insert,update on production_jobs,production_assets,course_delivery_workspaces,course_delivery_runs to service_role;
      create function commit_course_delivery_unit(uuid,uuid,jsonb,jsonb) returns integer language plpgsql as $$
      begin update public.course_delivery_workspaces set document=$3,revision=revision+1 where artifact_id=(select artifact_id from public.course_delivery_runs where id=$1);return 1;end $$;
      grant execute on function commit_course_delivery_unit(uuid,uuid,jsonb,jsonb) to service_role;`);
    await db.exec(await readFile('supabase/migrations/20261106040000_course_source_generation.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/20261107010000_course_source_extraction_diagnostics.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/20261107020000_course_source_batch_runs.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/20261107030000_course_source_staged_extraction.sql', 'utf8'));
  }
  await db.exec('set role service_role');
  return db;
}
async function draft(db, request = key, org = organization, title = 'Curso documental') {
  return (await db.query('select public.create_course_source_draft($1,$2,$3,$4) as id', [org, actor, request, title])).rows[0].id;
}
async function reserve(db, course, overrides = {}) {
  const input = { org: organization, actor, key: identifier(), filename: 'manual.txt', mime: 'text/plain', bytes: 100,
    hash: sequence.toString(16).padStart(64, '0'), ...overrides };
  return (await db.query('select public.reserve_course_source_upload($1,$2,$3,$4,$5,$6,$7,$8) as entry',
    [course, input.org, input.actor, input.key, input.filename, input.mime, input.bytes, input.hash])).rows[0].entry;
}
async function confirm(db, entry, overrides = {}) {
  const input = { org: organization, actor, hash: entry.expected_sha256, bytes: entry.size_bytes, ...overrides };
  return (await db.query('select public.confirm_course_source_upload($1,$2,$3,$4,$5,$6) as entry',
    [entry.artifact_id, input.org, input.actor, entry.id, input.hash, input.bytes])).rows[0].entry;
}

test('borrador idempotente conserva DRAFT sin metadata de generación', async () => {
  const db = await database();
  try {
    const course = await draft(db); assert.equal(await draft(db), course);
    assert.deepEqual((await db.query('select state from artifacts')).rows, [{ state: 'DRAFT' }]);
    assert.equal((await db.query('select policy from course_source_settings')).rows[0].policy, null);
    await assert.rejects(draft(db, key, organization, 'Otro título'), /SOURCE_CONFLICT/);
  } finally { await db.close(); }
});

test('reserva y confirmación son idempotentes y el original queda vinculado al curso', async () => {
  const db = await database();
  try {
    const course = await draft(db);
    const entry = await reserve(db, course, { key, hash: 'a'.repeat(64) });
    assert.equal((await reserve(db, course, { key, hash: 'a'.repeat(64) })).id, entry.id);
    assert.equal(entry.storage_path, `organizations/${organization}/courses/${course}/${entry.id}`);
    const uploaded = await confirm(db, entry);
    assert.equal(uploaded.status, 'UPLOADED');
    assert.deepEqual(await confirm(db, entry), uploaded);
    await assert.rejects(reserve(db, course, { key, bytes: 101, hash: 'a'.repeat(64) }), /SOURCE_CONFLICT/);
    await assert.rejects(reserve(db, course, { hash: 'a'.repeat(64) }), /SOURCE_CONFLICT/);
    await assert.rejects(db.query('update course_source_documents set filename=$1 where id=$2', ['otro.txt', entry.id]), /SOURCE_CONFLICT/);
  } finally { await db.close(); }
});

test('otra organización, otro actor y bytes distintos no confirman reservas', async () => {
  const db = await database();
  try {
    const course = await draft(db); const entry = await reserve(db, course);
    await assert.rejects(reserve(db, course, { org: otherOrganization }), /SOURCE_NOT_FOUND/);
    await assert.rejects(confirm(db, entry, { org: otherOrganization }), /SOURCE_NOT_FOUND/);
    await assert.rejects(confirm(db, entry, { actor: otherActor }), /SOURCE_NOT_FOUND/);
    await assert.rejects(confirm(db, entry, { hash: 'b'.repeat(64) }), /SOURCE_CONFLICT/);
    await assert.rejects(confirm(db, entry, { bytes: 101 }), /SOURCE_CONFLICT/);
    assert.equal((await db.query('select status from course_source_documents')).rows[0].status, 'RESERVED');
  } finally { await db.close(); }
});

test('cuota por curso se aplica antes de crear otra reserva', async () => {
  const db = await database();
  try {
    const course = await draft(db);
    for (let index = 0; index < 50; index++) await reserve(db, course);
    await assert.rejects(reserve(db, course), /SOURCE_QUOTA/);
    assert.equal((await db.query('select count(*)::int as total from course_source_documents')).rows[0].total, 50);
  } finally { await db.close(); }
});

test('reserva vencida no se confirma ni se renueva por reintentar', async () => {
  const db = await database();
  try {
    const course = await draft(db); const entry = await reserve(db, course);
    const expired = { ...entry, id: identifier(), request_key: identifier(), expected_sha256: 'd'.repeat(64), expires_at: '2000-01-01T00:00:00Z' };
    expired.storage_path = `organizations/${organization}/courses/${course}/${expired.id}`;
    await db.query('insert into course_source_documents select (jsonb_populate_record(null::course_source_documents,$1::jsonb)).*', [JSON.stringify(expired)]);
    await assert.rejects(confirm(db, expired), /SOURCE_EXPIRED/);
    const retried = await reserve(db, course, { key: expired.request_key, hash: expired.expected_sha256 });
    assert.equal(Date.parse(retried.expires_at), Date.parse(expired.expires_at));
    assert.equal(retried.status, 'RESERVED');
  } finally { await db.close(); }
});

test('cuota de bytes es transaccional y no consume una clave fallida', async () => {
  const db = await database();
  try {
    const course = await draft(db);
    for (let index = 0; index < 13; index++) await reserve(db, course, { bytes: 15 * 1024 * 1024 });
    await assert.rejects(reserve(db, course, { key, bytes: 15 * 1024 * 1024 }), /SOURCE_QUOTA/);
    assert.equal((await reserve(db, course, { key, bytes: 100 })).status, 'RESERVED');
  } finally { await db.close(); }
});

test('RLS y grants deniegan tablas y RPC a navegador; snapshots son inmutables para backend', async () => {
  const db = await database();
  try {
    const tables = ['course_source_settings', 'course_source_drafts', 'course_source_documents', 'course_source_fragments',
      'course_source_assignments', 'course_source_snapshots', 'course_source_snapshot_items',
      'course_source_upload_reconciliation','course_source_review_versions','course_source_review_approvals','course_source_policy_changes'];
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      for (const table of tables) {
        await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
        await assert.rejects(db.query(`delete from public.${table}`), /permission denied/);
      }
      await assert.rejects(draft(db), /permission denied/);
      await assert.rejects(reserve(db, identifier()), /permission denied/);
    }
    await db.exec('set role service_role');
    await assert.rejects(db.exec('update course_source_snapshots set source_revision=999'), /permission denied/);
    await assert.rejects(db.exec("update course_source_fragments set text_content='otro'"), /permission denied/);
    await assert.rejects(db.exec('delete from course_source_documents'), /permission denied/);
    const security = (await db.query(`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any($1::text[])`, [tables])).rows;
    assert.equal(security.length, tables.length); assert.ok(security.every(row => row.relrowsecurity));
  } finally { await db.close(); }
});

test('FK compuestas impiden asignar fragmentos de otro curso al snapshot', async () => {
  const db = await database();
  try {
    const course = await draft(db); const otherCourse = await draft(db, identifier());
    const entry = await reserve(db, course); const fragment = identifier();
    await db.query(`insert into course_source_fragments(id,artifact_id,document_id,ordinal,text_content,content_sha256,locator)
      values($1,$2,$3,0,'Texto',$4,'{"characterStart":0}')`, [fragment, course, entry.id, 'a'.repeat(64)]);
    const snapshot = identifier();
    await db.query(`insert into course_source_snapshots(id,artifact_id,execution_id,stage,policy,source_revision,syllabus_content_version,context_sha256)
      values($1,$2,$3,'BASE','DOCUMENTS_ONLY',0,0,$4)`, [snapshot, otherCourse, identifier(), 'a'.repeat(64)]);
    await assert.rejects(db.query(`insert into course_source_snapshot_items(artifact_id,snapshot_id,document_id,fragment_id,ordinal)
      values($1,$2,$3,$4,0)`, [otherCourse, snapshot, entry.id, fragment]), /foreign key/);
  } finally { await db.close(); }
});

test('Storage privado resiste una política histórica permisiva sin afectar otros buckets', async () => {
  const db = await database();
  try {
    await db.exec("insert into storage.objects(bucket_id,name) values('course-source-originals','privado'),('thumbnails','publico')");
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      assert.deepEqual((await db.query('select name from storage.objects')).rows, [{ name: 'publico' }]);
      await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values('course-source-originals','sin-reserva')"), /row-level security/);
      assert.equal((await db.query("delete from storage.objects where bucket_id='course-source-originals' returning id")).rows.length, 0);
    }
  } finally { await db.close(); }
});

test('extracción tiene lease único y completa fragmentos atómicamente sin aceptar un token ajeno', async () => {
  const db = await database();
  try {
    const course = await draft(db); const entry = await reserve(db, course); await confirm(db, entry);
    const command = async (action, token = null, fragments = []) => (await db.query(
      'select process_course_source_document($1,$2,$3,$4,$5,$6::jsonb) as token',
      [entry.id, course, organization, action, token, JSON.stringify(fragments)])).rows[0].token;
    const lease = await command('reserve'); assert.ok(lease);
    assert.equal(await command('reserve'), null);
    await assert.rejects(command('complete', identifier()), /SOURCE_CONFLICT/);
    const fragments = [{ ordinal: 0, text: 'Contenido propio', sha256: 'a'.repeat(64), locator: { characterStart: 0 } }];
    await command('complete', lease, fragments);
    assert.equal((await db.query('select status from course_source_documents')).rows[0].status, 'READY');
    assert.equal((await db.query('select count(*)::int as total from course_source_fragments')).rows[0].total, 1);
    assert.equal(await command('reserve'), null);
    await assert.rejects(command('complete', lease, fragments), /SOURCE_CONFLICT/);
    await command('retire');
    assert.equal((await db.query('select status from course_source_documents')).rows[0].status, 'RETIRED');
    await assert.rejects(command('reserve'), /SOURCE_CONFLICT/);
  } finally { await db.close(); }
});

test('la extracción registra un diagnóstico seguro y recupera una sola vez un fallo histórico agotado', async () => {
  const db = await database(true);
  try {
    const course = await draft(db);
    const entry = await reserve(db, course);
    await confirm(db, entry);
    const command = async (action, token = null, payload = []) => (await db.query(
      'select process_course_source_document($1,$2,$3,$4,$5,$6::jsonb) as token',
      [entry.id, course, organization, action, token, JSON.stringify(payload)])).rows[0].token;
    for (let attempt = 0; attempt < 3; attempt++) {
      await command('fail', await command('reserve'), { diagnosticCode: 'dato privado no admitido' });
    }
    const recovery = await command('reserve');
    assert.ok(recovery);
    assert.equal(await command('reserve'), null);
    await command('fail', recovery, { diagnosticCode: 'SOURCE_PERSIST_FAILED' });
    const stored = (await db.query('select status, diagnostic_code, extraction_attempts, extraction_token from course_source_documents')).rows[0];
    assert.deepEqual(stored, { status: 'FAILED', diagnostic_code: 'SOURCE_PERSIST_FAILED', extraction_attempts: 4, extraction_token: null });
    await assert.rejects(command('reserve'), /SOURCE_CONFLICT/);
    await db.exec('set role authenticated');
    await assert.rejects(command('reserve'), /permission denied/);
  } finally { await db.close(); }
});

test('una publicación anterior se invalida sin revertir READY ni aceptar un envío obsoleto', async () => {
  const db = await database(true);
  try {
    const course = await draft(db);
    await db.query("update course_source_settings set policy='WEB_ONLY' where artifact_id=$1", [course]);
    await db.query("insert into publication_requests(artifact_id,status) values($1,'READY')", [course]);
    await db.query("update course_source_settings set policy='DOCUMENTS_ONLY',revision=revision+1 where artifact_id=$1", [course]);
    const entry = await reserve(db, course);
    await confirm(db, entry);
    const command = async (action, token = null, fragments = []) => (await db.query(
      'select process_course_source_document($1,$2,$3,$4,$5,$6::jsonb) as token',
      [entry.id, course, organization, action, token, JSON.stringify(fragments)])).rows[0].token;
    const fragment = { ordinal: 0, text: 'Documento aprobado para extracción 😀', sha256: 'a'.repeat(64), locator: { characterStart: 0 } };
    await command('complete', await command('reserve'), [fragment]);
    assert.equal((await db.query('select status from course_source_documents')).rows[0].status, 'READY');
    assert.equal((await db.query('select upstream_dirty from publication_requests')).rows[0].upstream_dirty, true);
    await assert.rejects(db.query("update publication_requests set status='SENT' where artifact_id=$1", [course]), /SOURCE_REVIEW_REQUIRED/);
  } finally { await db.close(); }
});

test('sustitución conserva original hasta READY, serializa sucesores y conserva historia inmutable', async () => {
  const db = await database();
  try {
    const course = await draft(db); const original = await reserve(db, course); await confirm(db, original);
    const process = async (entry, action, token = null) => (await db.query(
      'select process_course_source_document($1,$2,$3,$4,$5,$6::jsonb) as token',
      [entry.id, course, organization, action, token, JSON.stringify([{ordinal:0,text:'Texto fuente',sha256:'a'.repeat(64),locator:{characterStart:0}}])])).rows[0].token;
    await process(original, 'complete', await process(original, 'reserve'));
    const replacementKey = identifier();
    const replace = async (replacementId = original.id, requestKey = replacementKey, hash = 'e'.repeat(64)) =>
      (await db.query('select reserve_course_source_upload_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) as entry',
        [course, organization, actor, requestKey, 'nuevo.txt','text/plain',100,hash,replacementId])).rows[0].entry;
    const next = await replace(); assert.equal(next.supersedes_id, original.id);
    assert.equal((await replace()).id, next.id);
    assert.equal((await db.query('select status from course_source_documents where id=$1',[original.id])).rows[0].status,'READY');
    await assert.rejects(replace(original.id,identifier(),'f'.repeat(64)), /SOURCE_CONFLICT/);
    await assert.rejects(replace(identifier(),identifier(),'f'.repeat(64)), /SOURCE_NOT_FOUND/);
    await confirm(db,next);
    await process(next,'complete',await process(next,'reserve'));
    assert.equal((await db.query('select status from course_source_documents where id=$1',[original.id])).rows[0].status,'RETIRED');
    assert.equal((await db.query('select count(*)::int as total from course_source_fragments')).rows[0].total,2);
    await assert.rejects(db.query('update course_source_documents set supersedes_id=null where id=$1',[next.id]), /SOURCE_CONFLICT/);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from course_source_upload_reconciliation'), /permission denied/);
    await assert.rejects(replace(), /permission denied/);
  } finally { await db.close(); }
});

test('política, asociaciones y aprobación tienen CAS y datos viejos se invalidan en la misma transacción',async()=>{
  const db=await database();
  try{
    const course=await draft(db);
    await assert.rejects(db.query("update artifacts set state='GENERATING' where id=$1",[course]),/SOURCE_CONTEXT_INTEGRATION_REQUIRED/);
    const hash=async()=>(await db.query('select course_source_curriculum($1) as context',[course])).rows[0].context.hash;
    const change=async(revision,action,payload={},curriculum)=>
      (await db.query('select change_course_source_review($1,$2,$3,$4,$5,$6,$7::jsonb) as revision',[course,organization,actor,revision,curriculum||await hash(),action,JSON.stringify(payload)])).rows[0].revision;
    assert.equal(await change(0,'policy',{policy:'DOCUMENTS_ONLY'}),1);
    await assert.rejects(change(0,'policy',{policy:'WEB_ONLY'}),/SOURCE_CONFLICT/);
    const document=await reserve(db,course);await confirm(db,document);
    const fragment=identifier();await db.query(`insert into course_source_fragments(id,artifact_id,document_id,ordinal,text_content,content_sha256,locator)
      values($1,$2,$3,0,'Manual de seguridad',$4,'{}')`,[fragment,course,document.id,'a'.repeat(64)]);
    await db.query("update course_source_documents set status='READY' where id=$1",[document.id]);
    assert.equal((await db.query('select revision from course_source_settings')).rows[0].revision,2);
    const associations=[{lessonId:'lesson-1',evidenceType:'DOCUMENT',evidenceId:fragment,requirementIds:['objective'],verified:true,conflict:false,resolution:''}];
    assert.equal(await change(2,'save',{associations}),3);
    await change(3,'approve');
    assert.equal((await db.query('select state from curation')).rows[0].state,'PHASE2_APPROVED');
    await assert.rejects(db.query("insert into materials(artifact_id,state) values($1,'PHASE3_GENERATING')",[course]),/SOURCE_CONTEXT_INTEGRATION_REQUIRED/);
    const oldHash=await hash();await db.query("insert into syllabus(artifact_id,modules) values($1,'[{\"lessons\":[]}]')",[course]);
    await assert.rejects(change(3,'approve',{},oldHash),/SOURCE_CONFLICT/);
    await db.query("update course_source_documents set status='RETIRED' where id=$1",[document.id]);
    assert.equal((await db.query('select approved_revision from course_source_settings')).rows[0].approved_revision,null);
    assert.equal((await db.query('select state from curation')).rows[0].state,'PHASE2_BLOCKED');
    await assert.rejects(db.query("update curation set state='PHASE2_APPROVED'"),/SOURCE_REVIEW_REQUIRED/);
    await db.exec('set role authenticated');await assert.rejects(db.query('select * from course_source_review_versions'),/permission denied/);
  }finally{await db.close();}
});

test('fallo de invalidación revierte política, revisión y metadata; WEB_ONLY conserva generación',async()=>{
  const db=await database();
  try{
    const course=await draft(db);await db.query('insert into materials(artifact_id) values($1)',[course]);
    await db.exec('reset role;alter table materials add constraint test_fail_invalidation check(upstream_dirty=false) not valid;set role service_role');
    const hash=(await db.query('select course_source_curriculum($1) as context',[course])).rows[0].context.hash;
    const change=(policy)=>db.query('select change_course_source_review($1,$2,$3,0,$4,\'policy\',$5::jsonb)',[course,organization,actor,hash,JSON.stringify({policy})]);
    await assert.rejects(change('DOCUMENTS_ONLY'),/test_fail_invalidation/);
    assert.deepEqual((await db.query('select policy,revision from course_source_settings')).rows,[{policy:null,revision:0}]);
    assert.deepEqual((await db.query('select generation_metadata from artifacts')).rows[0].generation_metadata,{});
    await db.exec('reset role;alter table materials drop constraint test_fail_invalidation;set role service_role');
    await change('WEB_ONLY');await db.query("update materials set state='PHASE3_GENERATING' where artifact_id=$1",[course]);
    await db.query("update artifacts set state='GENERATING' where id=$1",[course]);
    assert.equal((await db.query('select state from materials')).rows[0].state,'PHASE3_GENERATING');
  }finally{await db.close();}
});

async function generationFixture(db, seedBase = true) {
  const course=await draft(db);
  const hash=async()=>(await db.query('select course_source_curriculum($1) as context',[course])).rows[0].context.hash;
  const change=async(action,payload={})=>{const revision=(await db.query('select revision from course_source_settings where artifact_id=$1',[course])).rows[0].revision;
    return db.query('select change_course_source_review($1,$2,$3,$4,$5,$6,$7::jsonb)',[course,organization,actor,revision,await hash(),action,JSON.stringify(payload)]);};
  await change('policy',{policy:'DOCUMENTS_ONLY'});
  const document=await reserve(db,course);await confirm(db,document);
  const text='El manual exige verificar la identidad antes de conceder acceso al curso.';
  const fragment=identifier(),sha=createHash('sha256').update(text).digest('hex');
  const locator={characterStart:0,characterEnd:text.length};
  await db.query('insert into course_source_fragments(id,artifact_id,document_id,ordinal,text_content,content_sha256,locator) values($1,$2,$3,0,$4,$5,$6::jsonb)',[fragment,course,document.id,text,sha,JSON.stringify(locator)]);
  await db.query("update course_source_documents set status='READY' where id=$1",[document.id]);
  const manifest=[{id:fragment,documentId:document.id,kind:'DOCUMENT',title:'manual.txt',hash:sha,locator}];
  const snapshot=async(stage='BASE',lesson=null,org=organization,execution=identifier())=>{const revision=(await db.query('select revision from course_source_settings where artifact_id=$1',[course])).rows[0].revision;
    const fingerprint=(await db.query('select course_source_generation_fingerprint($1,$2) as hash',[course,stage])).rows[0].hash;
    return (await db.query('select snapshot_course_source_generation($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as id',[course,org,execution,stage,revision,fingerprint,lesson,sha,JSON.stringify(manifest)])).rows[0].id;};
  const attest=async(id,output,quote=text)=>(await db.query('select attest_course_source_generation($1,$2::jsonb,$3::jsonb) as id',[id,JSON.stringify(output),JSON.stringify([{sourceId:fragment,quote,claim:'Verificar identidad'}])])).rows[0].id;
  const base={nombres:['Manual seguro'],objetivos:['Verificar identidad'],descripcion:{texto:'Verificar identidad antes de conceder acceso al curso.'}};
  if (seedBase) {
    const baseReceipt=await attest(await snapshot('BASE'),base);
    await db.query("update artifacts set nombres=$1::jsonb,objetivos=$2::jsonb,descripcion=$3::jsonb,source_evidence_id=$4,state='APPROVED',generation_metadata=generation_metadata||'{\"source_configuration_dirty\":false}'::jsonb where id=$5",[JSON.stringify(base.nombres),JSON.stringify(base.objetivos),JSON.stringify(base.descripcion),baseReceipt,course]);
  }
  return {course,document,fragment,text,change,snapshot,attest};
}

test('ingesta larga publica el texto completo de forma atómica y rechaza lotes incompletos', async () => {
  const db = await database(true);
  try {
    const course = await draft(db);
    const entry = await reserve(db,course);
    await confirm(db,entry);
    const lease = (await db.query("select process_course_source_document($1,$2,$3,'reserve',null) as token",
      [entry.id,course,organization])).rows[0].token;
    const pieces = Array.from({length:65},(_,ordinal)=>{
      const text = ordinal===64 ? 'x'.repeat(1980)+' 😀 sección final' : 'x'.repeat(2000);
      return {ordinal,text,sha256:createHash('sha256').update(text).digest('hex'),
        locator:{characterStart:ordinal*2000,characterEnd:ordinal*2000+text.length}};
    });
    const text = pieces.map(piece=>piece.text).join('');
    const stage = (action, fragments=null, token=lease, org=organization) => db.query(
      'select stage_course_source_extraction($1,$2,$3,$4,$5,$6,$7,$8)',
      [entry.id,course,org,token,action,fragments&&JSON.stringify(fragments),pieces.length,text.length]);
    await assert.rejects(stage('append',pieces.slice(0,16),lease,otherOrganization), /SOURCE_NOT_FOUND/);
    await assert.rejects(stage('append',pieces.slice(0,16),identifier()), /SOURCE_CONFLICT/);
    await stage('append',pieces.slice(0,16));
    await stage('append',pieces.slice(0,16));
    await assert.rejects(stage('publish'), /SOURCE_BATCH_INCOMPLETE/);
    assert.equal((await db.query('select count(*)::integer as count from course_source_fragments')).rows[0].count,0);
    for (let start=16;start<pieces.length;start+=16) await stage('append',pieces.slice(start,start+16));
    await stage('publish');
    await stage('publish');
    assert.equal((await db.query("select string_agg(text_content,'' order by ordinal) as text from course_source_fragments")).rows[0].text,text);
    assert.equal((await db.query('select status from course_source_documents')).rows[0].status,'READY');
    await assert.rejects(db.query('select * from course_source_extraction_batches'), /permission denied/);
    await db.exec('set role authenticated');
    await assert.rejects(stage('publish'), /permission denied/);
  } finally { await db.close(); }
});

test('lotes documentales conservan checkpoints, cercan leases y rechazan citas y revisiones obsoletas', async () => {
  const db = await database(true);
  try {
    const { course, document, fragment, text, change } = await generationFixture(db, false);
    const end = identifier();
    await db.query('insert into course_source_fragments(id,artifact_id,document_id,ordinal,text_content,content_sha256,locator) values($1,$2,$3,1,$4,$5,$6)',
      [end,course,document.id,'La excepción final requiere autorización expresa.','b'.repeat(64),{}]);
    const revision = (await db.query('select revision from course_source_settings')).rows[0].revision;
    const plan = [{fragmentIds:[fragment,end],requestTokens:100}];
    const create = async (input=plan, org=organization) => (await db.query(
      "select create_course_source_batch_run($1,$2,$3,$4,'test-v1',$5,now()+interval '1 hour',8,2,1000) as id",
      [course,org,revision,'a'.repeat(64),JSON.stringify(input)])).rows[0].id;
    await assert.rejects(create([{fragmentIds:[fragment],requestTokens:100}]), /SOURCE_BATCH_COVERAGE_INVALID/);
    await assert.rejects(create(plan,otherOrganization), /SOURCE_NOT_FOUND/);
    const run = await create();
    assert.equal(await create(),run);
    const command = async (action,path=null,lease=null,payload={},org=organization) => (await db.query(
      'select command_course_source_batch($1,$2,$3,$4,$5,$6) as result',
      [run,org,action,path,lease,JSON.stringify(payload)])).rows[0].result;
    await assert.rejects(command('status',null,null,{},otherOrganization), /SOURCE_NOT_FOUND/);
    const first = await command('claim');
    assert.equal((await command('claim')).status,'BUSY');
    assert.equal((await command('split',first.path,first.lease,{leftTokens:60,rightTokens:60})).status,'SPLIT');
    const left = await command('claim');
    assert.deepEqual(left.fragmentIds,[fragment]);
    const findings = [{fragmentId:fragment,quote:text,finding:'Verificar identidad'}];
    await assert.rejects(command('complete',left.path,left.lease,{findings:[{...findings[0],quote:'Una cita inventada del documento'}]}), /SOURCE_BATCH_FINDINGS_INVALID/);
    assert.equal((await command('complete',left.path,left.lease,{findings})).status,'CONFIRMED');
    assert.equal((await command('complete',left.path,left.lease,{findings})).status,'CONFIRMED');
    assert.deepEqual((await command('read',left.path)).findings,findings);
    const right = await command('claim');
    assert.deepEqual(right.fragmentIds,[end]);
    await db.exec('reset role; update course_source_batches set lease_until=now()-interval \'1 second\' where state=\'LEASED\'; set role service_role;');
    const recovered = await command('claim');
    assert.deepEqual(recovered.path,right.path);
    assert.notEqual(recovered.lease,right.lease);
    await assert.rejects(command('complete',right.path,right.lease,{findings:[]}), /SOURCE_CONFLICT/);
    await command('complete',recovered.path,recovered.lease,{findings:[]});
    assert.deepEqual(await command('status'),{status:'COMPLETE',confirmed:2,total:2,paused:0,attempts:4,reservedTokens:280});
    await change('policy',{policy:'DOCUMENTS_AND_WEB'});
    assert.equal((await command('status')).status,'STALE');
    await assert.rejects(db.query('select * from course_source_batches'), /permission denied/);
    await db.exec('set role authenticated');
    await assert.rejects(command('status'), /permission denied/);
  } finally { await db.close(); }
});

test('lotes documentales pausan un segundo fallo de salida y conservan el presupuesto al reanudar', async () => {
  const db = await database(true);
  try {
    const {course,fragment} = await generationFixture(db,false);
    const revision = (await db.query('select revision from course_source_settings')).rows[0].revision;
    const run = (await db.query(
      "select create_course_source_batch_run($1,$2,$3,$4,'test-v1',$5,now()+interval '1 hour',3,0,300) as id",
      [course,organization,revision,'a'.repeat(64),JSON.stringify([{fragmentIds:[fragment],requestTokens:100}])])).rows[0].id;
    const command = async (action,path=null,lease=null,payload={}) => (await db.query(
      'select command_course_source_batch($1,$2,$3,$4,$5,$6) as result',
      [run,organization,action,path,lease,JSON.stringify(payload)])).rows[0].result;
    const first = await command('claim');
    assert.equal((await command('fail',first.path,first.lease,{diagnostic:'INVALID_OUTPUT'})).status,'PENDING');
    assert.equal((await command('claim')).status,'NO_AVAILABLE_BATCH');
    await db.exec("reset role; update course_source_batches set retry_after=now(); set role service_role;");
    const correction = await command('claim');
    assert.equal(correction.correctionUsed,true);
    assert.equal((await command('fail',correction.path,correction.lease,{diagnostic:'INVALID_OUTPUT'})).status,'PAUSED');
    assert.equal((await command('status')).status,'PAUSED');
    assert.equal((await command('resume',correction.path)).status,'PENDING');
    const resumed = await command('claim');
    await command('fail',resumed.path,resumed.lease,{diagnostic:'INVALID_OUTPUT'});
    assert.equal((await command('resume',resumed.path)).status,'BUDGET_EXHAUSTED');
    assert.equal((await command('status')).reservedTokens,300);
  } finally { await db.close(); }
});

test('F4: el fallo inicial de Base termina sin recibo y no permite aprobar ni sustituir contenido',async()=>{
  const db=await database(true);
  try{
    const {course}=await generationFixture(db,false);
    await db.query("update artifacts set state='GENERATING' where id=$1",[course]);
    const failure={all_passed:false,results:[{code:'GENERATION_FAILED',passed:false,message:'Generación fallida'}]};
    await db.query("update artifacts set state='ESCALATED',validation_report=$2::jsonb where id=$1",[course,JSON.stringify(failure)]);
    assert.equal((await db.query('select state from artifacts where id=$1',[course])).rows[0].state,'ESCALATED');
    await assert.rejects(db.query("update artifacts set state='APPROVED' where id=$1",[course]),/SOURCE_GENERATION_STALE/);
    await assert.rejects(db.query("update artifacts set objetivos='[\"Contenido sin respaldo\"]' where id=$1",[course]),/SOURCE_GENERATION_STALE/);
  }finally{await db.close();}
});

test('F4: guarda resultados con recibo exacto, rechaza otra organización, citas inventadas y modificaciones posteriores',async()=>{
  const db=await database(true);
  try{
    const fixture=await generationFixture(db);const {course,snapshot,attest}=fixture;
    await assert.rejects(snapshot('BASE',null,otherOrganization),/SOURCE_NOT_FOUND/);
    const execution=identifier();const id=await snapshot('BASE',null,organization,execution);
    assert.equal(await snapshot('BASE',null,organization,execution),id);
    assert.equal((await db.query('select count(*)::integer as total from course_source_snapshots where execution_id=$1',[execution])).rows[0].total,1);
    const output={nombres:['Manual seguro'],objetivos:['Verificar identidad'],descripcion:{texto:'Verificar identidad antes de conceder acceso al curso.'}};
    await assert.rejects(attest(id,output,'Una cita inexistente y falsa'),/SOURCE_CITATION_INVALID/);
    const receipt=await attest(id,output);
    await db.query("update artifacts set nombres=$1::jsonb,objetivos=$2::jsonb,descripcion=$3::jsonb,source_evidence_id=$4,state='APPROVED' where id=$5",[JSON.stringify(output.nombres),JSON.stringify(output.objetivos),JSON.stringify(output.descripcion),receipt,course]);
    await assert.rejects(db.query("update artifacts set objetivos='[\"Inventar otra cosa\"]' where id=$1",[course]),/SOURCE_GENERATION_STALE/);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from course_source_generation_receipts'),/permission denied/);
    await assert.rejects(db.query('select * from course_source_delivery_receipts'),/permission denied/);
    await assert.rejects(db.query('select course_source_snapshot_current($1)',[id]),/permission denied/);
  }finally{await db.close();}
});

test('F4: un manual aprobado permite materiales; ediciones curriculares y retirada rechazan resultados obsoletos',async()=>{
  const db=await database(true);
  try{
    const {course,document,fragment,change,snapshot,attest}=await generationFixture(db);
    await assert.rejects(snapshot('MATERIALS','lesson-1'),/SOURCE_REVIEW_REQUIRED/);
    await change('save',{associations:[{lessonId:'lesson-1',evidenceType:'DOCUMENT',evidenceId:fragment,requirementIds:['objective'],verified:true,conflict:false,resolution:''}]});await change('approve');
    const id=await snapshot('MATERIALS','lesson-1');
    const content={text:'Verificar identidad antes de conceder acceso al curso.'};const receipt=await attest(id,content);
    const material=(await db.query("insert into materials(artifact_id,state) values($1,'PHASE3_GENERATING') returning id",[course])).rows[0].id;
    const lesson=(await db.query("insert into material_lessons(materials_id,lesson_id) values($1,'lesson-1-G2') returning id",[material])).rows[0].id;
    await db.query('insert into material_components(material_lesson_id,content,assets) values($1,$2::jsonb,$3::jsonb)',[lesson,JSON.stringify(content),JSON.stringify({course_source_evidence_id:receipt})]);
    await db.query('select assert_course_source_publication($1)',[course]);
    await db.query("update artifacts set generation_metadata=generation_metadata||'{\"source_configuration_dirty\":true}'::jsonb where id=$1",[course]);
    await assert.rejects(db.query('select assert_course_source_publication($1)',[course]),/SOURCE_UPSTREAM_REVIEW_REQUIRED/);
    await db.query("update artifacts set generation_metadata=generation_metadata||'{\"source_configuration_dirty\":false}'::jsonb where id=$1",[course]);
    await assert.rejects(db.query("update material_components set content='{\"text\":\"Cambiado\"}'"),/SOURCE_GENERATION_STALE/);
    await db.query("insert into syllabus(artifact_id,modules) values($1,'[{\"lessons\":[]}]')",[course]);
    assert.equal((await db.query('select course_source_snapshot_current($1) as valid',[id])).rows[0].valid,false);
    await assert.rejects(attest(id,content),/SOURCE_CONFLICT/);
    await assert.rejects(db.query('select assert_course_source_publication($1)',[course]),/SOURCE_REVIEW_REQUIRED/);
    await db.query("update course_source_documents set status='RETIRED' where id=$1",[document.id]);
    await assert.rejects(db.query("update materials set state='PHASE3_APPROVED' where id=$1",[material]),/SOURCE_REVIEW_REQUIRED/);
  }finally{await db.close();}
});

test('F4: producción liga sus jobs al contenido vigente y rechaza callbacks de una versión anterior',async()=>{
  const db=await database(true);
  try{
    const {course,fragment,change,snapshot,attest}=await generationFixture(db);
    await change('save',{associations:[{lessonId:'lesson-1',evidenceType:'DOCUMENT',evidenceId:fragment,requirementIds:['objective'],verified:true,conflict:false,resolution:''}]});await change('approve');
    const snapshotId=await snapshot('MATERIALS','lesson-1');
    const content={text:'Verificar identidad antes de conceder acceso al curso.'};const receipt=await attest(snapshotId,content);
    const material=(await db.query('insert into materials(artifact_id) values($1) returning id',[course])).rows[0].id;
    const lesson=(await db.query("insert into material_lessons(materials_id,lesson_id) values($1,'lesson-1') returning id",[material])).rows[0].id;
    const component=(await db.query('insert into material_components(material_lesson_id,content,assets) values($1,$2::jsonb,$3::jsonb) returning id',[lesson,JSON.stringify(content),JSON.stringify({course_source_evidence_id:receipt})])).rows[0].id;
    const job=(await db.query('insert into production_jobs(artifact_id,material_component_id) values($1,$2) returning id,input_snapshot',[course,component])).rows[0];
    assert.ok(job.input_snapshot.course_source_version.component_hash);
    await db.query('insert into production_assets(artifact_id,material_component_id,production_job_id) values($1,$2,$3)',[course,component,job.id]);
    const revised={text:'Verificar identidad antes de permitir acceso al curso.'};const next=await attest(snapshotId,revised);
    await db.query('update material_components set content=$1::jsonb,assets=$2::jsonb where id=$3',[JSON.stringify(revised),JSON.stringify({course_source_evidence_id:next}),component]);
    await assert.rejects(db.query("update production_jobs set status='SUCCEEDED' where id=$1",[job.id]),/SOURCE_GENERATION_STALE/);
    await assert.rejects(db.query('insert into production_assets(artifact_id,material_component_id,production_job_id) values($1,$2,$3)',[course,component,job.id]),/SOURCE_GENERATION_STALE/);
    await db.query("update production_jobs set status='FAILED' where id=$1",[job.id]);
  }finally{await db.close();}
});

test('F4: sesiones guardan recibos por unidad y su aprobación no acepta contenido editado sin respaldo',async()=>{
  const db=await database(true);
  try{
    const {course,snapshot,attest}=await generationFixture(db);const session=identifier(),run=identifier();
    const plan={text:'Verificar identidad antes de conceder acceso al curso.'};
    const document={config:{mode:'SYNCHRONOUS'},agenda:[{id:session}],plans:{[session]:plan},materials:{},planApproval:null,materialsApproval:null};
    await db.query('insert into course_delivery_workspaces(artifact_id,document) values($1,$2::jsonb)',[course,JSON.stringify(document)]);
    await db.query("insert into course_delivery_runs(id,artifact_id,operation) values($1,$2,'PLAN')",[run,course]);
    const receipt=await attest(await snapshot('PLAN'),plan);
    await db.query('select commit_course_source_delivery_unit($1,$2,$3::jsonb,$4::jsonb,$5,$6)',[run,identifier(),JSON.stringify(document),'[]',receipt,session]);
    await db.query("select assert_course_source_delivery($1,'PLAN')",[course]);
    document.plans[session]={text:'Contenido distinto sin comprobación'};document.planApproval={reviewed:true};
    await assert.rejects(db.query('update course_delivery_workspaces set document=$1::jsonb where artifact_id=$2',[JSON.stringify(document),course]),/SOURCE_GENERATION_STALE/);
    await db.exec('set role authenticated');await assert.rejects(db.query('select * from course_source_legacy_imports'),/permission denied/);
  }finally{await db.close();}
});

test('F4: reasignar o eliminar una URL revisada invalida la aprobación y el snapshot',async()=>{
  const db=await database(true);
  try{
    const {course,fragment,change,snapshot}=await generationFixture(db);
    await change('policy',{policy:'DOCUMENTS_AND_WEB'});
    const curation=(await db.query('insert into curation(artifact_id) values($1) returning id',[course])).rows[0].id;
    const row=(await db.query("insert into curation_rows(curation_id,lesson_id,apta,source_ref,validation_report) values($1,'lesson-1',true,'https://example.org/manual',$2::jsonb) returning id",[curation,JSON.stringify({status:'valid',content_excerpt:'Procedimiento de comprobación de identidad.'})])).rows[0].id;
    const association={lessonId:'lesson-1',evidenceType:'DOCUMENT',evidenceId:fragment,requirementIds:['objective'],verified:true,conflict:false,resolution:''};
    await change('save',{associations:[association,{...association,evidenceType:'WEB',evidenceId:row}]});await change('approve');
    const id=await snapshot('MATERIALS','lesson-1');
    await db.query("update curation_rows set lesson_id='lesson-2' where id=$1",[row]);
    assert.equal((await db.query('select approved_revision from course_source_settings where artifact_id=$1',[course])).rows[0].approved_revision,null);
    assert.equal((await db.query('select course_source_snapshot_current($1) as valid',[id])).rows[0].valid,false);
    await change('save',{associations:[association]});await change('approve');
    await db.query('delete from curation_rows where id=$1',[row]);
    assert.equal((await db.query('select approved_revision from course_source_settings where artifact_id=$1',[course])).rows[0].approved_revision,null);
  }finally{await db.close();}
});

test('F4: aprobar fuentes conserva la versión de temario importado y rechaza una revisión anterior',async()=>{
  const db=await database(true);
  try{
    const {course,fragment,change}=await generationFixture(db);
    await db.query("insert into syllabus(artifact_id,modules,content_version) values($1,'[{\"lessons\":[{\"id\":\"lesson-1\",\"title\":\"Verificar identidad\"}]}]',7)",[course]);
    await change('save',{associations:[{lessonId:'lesson-1',evidenceType:'DOCUMENT',evidenceId:fragment,requirementIds:['objective'],verified:true,conflict:false,resolution:''}]});await change('approve');
    assert.equal((await db.query('select syllabus_content_version from curation where artifact_id=$1',[course])).rows[0].syllabus_content_version,7);
    await db.query('update syllabus set content_version=8 where artifact_id=$1',[course]);
    await assert.rejects(change('approve'),/SOURCE_CONFLICT/);
  }finally{await db.close();}
});

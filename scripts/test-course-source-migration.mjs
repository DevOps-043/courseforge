import assert from 'node:assert/strict';
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

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table profiles(id uuid primary key);
    create table artifacts(id uuid primary key, organization_id uuid not null, created_by uuid references profiles(id),
      idea_central text not null, course_id text, state text not null default 'DRAFT');
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
      'course_source_assignments', 'course_source_snapshots', 'course_source_snapshot_items'];
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

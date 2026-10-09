import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';

// Optional isolated QA runtime; this does not add a production dependency.
// npm install --prefix apps/web/.tmp/syllabus-sql-runtime --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.8
const root = fileURLToPath(new URL('../', import.meta.url));
const runtimePath = process.env.SYLLABUS_TEST_PGLITE_PATH || path.join(root, 'apps/web/.tmp/syllabus-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(runtimePath).href);
const migration = await readFile(path.join(root, 'supabase/migrations/20261009010000_provided_syllabus_imports.sql'), 'utf8');
const artifactId = '2908b47b-77a0-4591-a527-ac95882fc782';
const secondArtifactId = '6a0bdc0e-9612-451c-9cbc-62e8de2a602c';
const documentId = '85777010-cb1f-468f-8ddb-2d4e3cbd2c50';
const importId = '9bcc6fe7-08ac-446c-98ab-b3b035d2c7b0';
const moduleId = 'a333ed83-4133-4616-b2c9-3a7a36521286';
const lessonId = '8409b1e8-47e0-4aa9-a793-45ead47ff397';
const baseline = [{ id: moduleId, title: 'Seguridad', objective_general_ref: 'Identificar límites de confianza', sourceQuote: 'Seguridad',
  lessons: [{ id: lessonId, title: 'Validación', objective_specific: 'Validar entradas no confiables', topics: ['Tipos'], sourceQuote: 'Validación' }] }];
const modules = baseline.map(module => ({ id: module.id, title: module.title, objective_general_ref: module.objective_general_ref,
  lessons: module.lessons.map(lesson => ({ id: lesson.id, title: lesson.title, objective_specific: lesson.objective_specific, topics: lesson.topics, estimated_minutes: 30 })) }));

test('bounded document storage rejects the entire batch above the artifact quota', async () => {
  const db = await database();
  try {
    await db.query(`insert into syllabus_source_documents(artifact_id,filename,mime_type,size_bytes,content_sha256,extracted_text)
      select $1,'file.txt','text/plain',1,$2,'text' from generate_series(1,48)`, [artifactId, 'b'.repeat(64)]);
    await assert.rejects(db.query(`insert into syllabus_source_documents(artifact_id,filename,mime_type,size_bytes,content_sha256,extracted_text)
      select $1,'file.txt','text/plain',1,$2,'text' from generate_series(1,2)`, [artifactId, 'b'.repeat(64)]), /SYLLABUS_DOCUMENT_QUOTA/);
    assert.equal((await db.query('select count(*)::integer as total from syllabus_source_documents')).rows[0].total, 49);
  } finally { await db.close(); }
});

test('content version is controlled by the database even when a caller forges the counter', async () => {
  const db = await database();
  try {
    await prepared(db);
    await db.exec('update syllabus set content_version=999');
    assert.equal((await db.query('select content_version from syllabus')).rows[0].content_version, 1);
  } finally { await db.close(); }
});

test('approval compare-and-swap cannot approve content changed after validation', async () => {
  const db = await database();
  try {
    await prepared(db);
    const validatedVersion = (await db.query('select content_version from syllabus')).rows[0].content_version;
    const changed = structuredClone(modules); changed[0].lessons[0].estimated_minutes = 35;
    await db.query('update syllabus set modules=$1::jsonb', [JSON.stringify(changed)]);
    const approval = await db.query(`update syllabus set state='STEP_APPROVED' where artifact_id=$1 and content_version=$2 returning id`, [artifactId, validatedVersion]);
    assert.equal(approval.rows.length, 0);
    assert.equal((await db.query('select state from syllabus')).rows[0].state, 'STEP_READY_FOR_QA');
  } finally { await db.close(); }
});

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table profiles(id uuid primary key);
    create table artifacts(id uuid primary key, organization_id text);
    create table syllabus(id uuid primary key default gen_random_uuid(), artifact_id uuid not null unique references artifacts(id) on delete cascade,
      route text not null default 'B_NO_SOURCE', modules jsonb not null default '[]', source_summary jsonb, validation jsonb, qa jsonb,
      state text not null default 'STEP_DRAFT', iteration_count integer default 0, updated_at timestamptz default now());
    create table instructional_plans(id uuid primary key default gen_random_uuid(), artifact_id uuid unique references artifacts(id) on delete cascade,
      state text default 'STEP_DRAFT', lesson_plans jsonb default '[]', upstream_dirty boolean default false, upstream_dirty_source text, iteration_count integer default 0);
    create table curation(id uuid primary key default gen_random_uuid(), artifact_id uuid unique references artifacts(id) on delete cascade,
      state text default 'PHASE2_DRAFT', upstream_dirty boolean default false, upstream_dirty_source text, attempt_number integer default 0);
    create table materials(id uuid primary key default gen_random_uuid(), artifact_id uuid unique references artifacts(id) on delete cascade,
      state text default 'PHASE3_DRAFT', upstream_dirty boolean default false, upstream_dirty_source text, version integer default 0);
    create table publication_requests(id uuid primary key default gen_random_uuid(), artifact_id uuid unique references artifacts(id) on delete cascade,
      status text default 'DRAFT', lesson_videos jsonb default '{}', selected_lessons jsonb default '[]', upstream_dirty boolean default false, upstream_dirty_source text);
    grant usage on schema public to service_role, authenticated, anon;
    grant all on all tables in schema public to service_role;
  `);
  await db.exec(migration);
  await db.query('insert into artifacts(id,organization_id) values ($1, $2),($3,$4)', [artifactId, 'org-a', secondArtifactId, 'org-b']);
  await db.query(`insert into syllabus_source_documents(id,artifact_id,filename,mime_type,size_bytes,content_sha256,extracted_text)
    values($1,$2,'temario.txt','text/plain',100,$3,'Seguridad\nValidación')`, [documentId, artifactId, 'a'.repeat(64)]);
  await db.query(`insert into syllabus_imports(id,artifact_id,primary_document_id,idempotency_key,operation,lease_expires_at)
    values($1,$2,$3,gen_random_uuid(),'parse',now()+interval '10 minutes')`, [importId, artifactId, documentId]);
  return db;
}
async function transition(db, revision, action, payload = {}) {
  const result = await db.query('select transition_syllabus_import($1,$2,$3,$4,$5::jsonb,null) as entry', [artifactId, importId, revision, action, JSON.stringify(payload)]);
  return result.rows[0].entry;
}
async function prepared(db) {
  await transition(db, 1, 'parsed', { outline: baseline, issues: [], unassignedTopics: [] });
  await transition(db, 2, 'confirm');
  await transition(db, 3, 'reserve_enrich');
  return transition(db, 4, 'enriched', { modules, metadata: { import_id: importId, import_revision: 3, import_baseline: baseline }, validation: { automatic_pass: true, checks: [] } });
}

test('migration executes and complete import preserves confirmed snapshot', async () => {
  const db = await database();
  try {
    const result = await prepared(db);
    assert.equal(result.status, 'CONFIRMED');
    const syllabus = (await db.query('select * from syllabus')).rows[0];
    assert.equal(syllabus.input_mode, 'PROVIDED_SYLLABUS');
    assert.equal(syllabus.content_version, 1);
    assert.deepEqual(syllabus.modules, modules);
    const snapshot = (await db.query('select * from syllabus_import_revisions where revision=3')).rows[0];
    assert.deepEqual(snapshot.outline, baseline);
  } finally { await db.close(); }
});

test('stale revisions and concurrent artifact reservations are rejected', async () => {
  const db = await database();
  try {
    await transition(db, 1, 'parsed', { outline: baseline, issues: [], unassignedTopics: [] });
    await assert.rejects(transition(db, 1, 'confirm'), /CONFLICT/);
    await transition(db, 2, 'confirm');
    await transition(db, 3, 'reserve_enrich');
    await assert.rejects(transition(db, 4, 'reserve_enrich'), /BUSY/);
    await assert.rejects(db.query(`insert into syllabus_imports(artifact_id,primary_document_id,idempotency_key,lease_expires_at) values($1,$2,gen_random_uuid(),now()+interval '1 minute')`, [artifactId, documentId]), /syllabus_imports_active_artifact_idx/);
  } finally { await db.close(); }
});

test('database rejects forged baseline metadata and structure mutations', async () => {
  const db = await database();
  try {
    await prepared(db);
    const changed = structuredClone(modules); changed[0].lessons[0].title = 'Tema inventado';
    await assert.rejects(db.query('update syllabus set modules=$1::jsonb', [JSON.stringify(changed)]), /FIDELITY/);
    await assert.rejects(db.query(`update syllabus set source_summary='{"import_revision":999}'`), /FIDELITY/);
    await assert.rejects(db.query(`update syllabus set input_mode='IDEA'`), /RESET_REQUIRED/);
    await assert.rejects(db.query(`update syllabus_imports set extracted_outline='[]'`), /IMMUTABLE/);
  } finally { await db.close(); }
});

test('cross-artifact document references fail at the database boundary', async () => {
  const db = await database();
  try {
    await assert.rejects(db.query('insert into syllabus_imports(artifact_id,primary_document_id,idempotency_key) values($1,$2,gen_random_uuid())', [secondArtifactId, documentId]), /foreign key/);
    await assert.rejects(db.query('select transition_syllabus_import($1,$2,1,$3,$4::jsonb,null)', [secondArtifactId, importId, 'confirm', '{}']), /NOT_FOUND/);
  } finally { await db.close(); }
});

test('untrusted SQL roles cannot read source text, modify snapshots or call mutation RPC', async () => {
  const db = await database();
  try {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select extracted_text from syllabus_source_documents'), /permission denied/);
      await assert.rejects(db.query('select * from syllabus_import_revisions'), /permission denied/);
      await assert.rejects(transition(db, 1, 'confirm'), /permission denied/);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});

test('expired workers cannot write and recovery retains original candidate', async () => {
  const db = await database();
  try {
    await db.query(`update syllabus_imports set lease_expires_at=now()-interval '1 second'`);
    await assert.rejects(transition(db, 1, 'parsed', { outline: baseline, issues: [], unassignedTopics: [] }), /CONFLICT/);
    const failed = await transition(db, 1, 'recover');
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.lease_expires_at, null);
    const retried = await transition(db, 2, 'retry');
    assert.equal(retried.attempt_count, 2);
  } finally { await db.close(); }
});

test('content change invalidates dependents atomically and stale stamps cannot be forged', async () => {
  const db = await database();
  try {
    await prepared(db);
    await db.exec(`update syllabus set state='STEP_APPROVED'`);
    await db.query(`insert into instructional_plans(artifact_id,state,iteration_count) values($1,'STEP_PROCESSING',1)`, [artifactId]);
    await db.query(`update instructional_plans set lesson_plans=$1::jsonb,state='STEP_APPROVED'`, [JSON.stringify([{ lesson_id: lessonId }])]);
    await db.query(`insert into curation(artifact_id,state,attempt_number) values($1,'PHASE2_GENERATING',1)`, [artifactId]);
    await db.exec(`update curation set state='PHASE2_APPROVED'`);
    await db.query(`insert into materials(artifact_id,state,version) values($1,'PHASE3_GENERATING',1)`, [artifactId]);
    await db.exec(`update materials set state='PHASE3_APPROVED'`);
    await db.query('insert into publication_requests(artifact_id) values($1)', [artifactId]);
    await db.exec(`update publication_requests set status='READY'`);
    const changed = structuredClone(modules); changed[0].lessons[0].estimated_minutes = 35;
    await db.query('update syllabus set modules=$1::jsonb', [JSON.stringify(changed)]);
    for (const table of ['instructional_plans','curation','materials','publication_requests']) {
      const row = (await db.query(`select upstream_dirty,syllabus_content_version from ${table}`)).rows[0];
      assert.equal(row.upstream_dirty, true);
      assert.equal(row.syllabus_content_version, 1);
    }
    await db.exec(`update instructional_plans set upstream_dirty=false`);
    await assert.rejects(db.exec(`update instructional_plans set syllabus_content_version=2`), /VERSION_IMMUTABLE/);
    await assert.rejects(db.exec(`update curation set state='PHASE2_GENERATING',attempt_number=2`), /APPROVAL_REQUIRED/);
    await db.exec(`update syllabus set state='STEP_APPROVED'`);
    await assert.rejects(db.exec(`update curation set state='PHASE2_GENERATING',attempt_number=2`), /STALE_PLAN/);
  } finally { await db.close(); }
});

test('dependent invalidation failure rolls back syllabus content and version', async () => {
  const db = await database();
  try {
    await prepared(db);
    await db.exec(`update syllabus set state='STEP_APPROVED'`);
    await db.query(`insert into instructional_plans(artifact_id,state) values($1,'STEP_PROCESSING')`, [artifactId]);
    await db.exec(`create function fail_invalidation() returns trigger language plpgsql as $$ begin raise exception 'forced invalidation failure'; end $$;
      create trigger fail_invalidation before update on instructional_plans for each row execute function fail_invalidation()`);
    const changed = structuredClone(modules); changed[0].lessons[0].estimated_minutes = 35;
    await assert.rejects(db.query('update syllabus set modules=$1::jsonb', [JSON.stringify(changed)]), /forced invalidation failure/);
    const row = (await db.query('select modules,content_version from syllabus')).rows[0];
    assert.equal(row.content_version, 1);
    assert.deepEqual(row.modules, modules);
  } finally { await db.close(); }
});

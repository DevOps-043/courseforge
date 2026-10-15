import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Existing isolated PostgreSQL runtime; no production dependency or remote DB.
const root = fileURLToPath(new URL('../', import.meta.url));
const runtimePath = process.env.GOOGLE_FONT_TEST_PGLITE_PATH
  || path.join(root, 'apps/web/.tmp/syllabus-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(runtimePath).href);
const migration = await readFile(path.join(root, 'supabase/migrations/20261010210000_google_font_candidate_bundles.sql'), 'utf8');
const organizationId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-000000000002';
const fontId = '00000000-0000-4000-8000-000000000003';
const cssUrl = 'https://fonts.googleapis.com/css2?family=Inter';
const signature = 'public.commit_google_font_candidate_bundle(uuid,uuid,uuid,text,text,text,text)';

async function database() {
  const db = new PGlite();
  try {
    // Minimal compatible dependencies. Not a Supabase Storage/RLS integration test.
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA storage;
      CREATE TABLE public.organizations (id uuid PRIMARY KEY, is_active boolean);
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_active boolean);
      CREATE TABLE public.organization_user_roles (organization_id uuid, user_id uuid, platform_role text);
      CREATE TABLE public.organization_slide_fonts (id uuid PRIMARY KEY, organization_id uuid, family text, source text, status text, css_url text);
      CREATE TABLE storage.objects (bucket_id text, name text, metadata jsonb, PRIMARY KEY(bucket_id,name));
      INSERT INTO public.organizations VALUES ('${organizationId}',true);
      INSERT INTO public.profiles VALUES ('${actorId}',true);
      INSERT INTO public.organization_user_roles VALUES ('${organizationId}','${actorId}','ADMIN');
      INSERT INTO public.organization_slide_fonts VALUES ('${fontId}','${organizationId}','Inter','google','READY','${cssUrl}');
    `);
    return db;
  } catch (error) { await db.close(); throw error; }
}

function manifest(mimeType = 'font/woff2') {
  const file = { checksumSha256: 'a'.repeat(64), fileSizeBytes: 48, mimeType,
    embeddingCheck: ['font/woff', 'font/woff2'].includes(mimeType) ? 'UNVERIFIED_COMPRESSED' : 'ALLOWED' };
  return { format: 'courseforge-google-font-candidate-bundle-v1', source: 'google', family: 'Inter',
    stylesheetChecksumSha256: 'b'.repeat(64), files: [file], faces: [
      { ...file, style: 'normal', weight: { minimum: 400, maximum: 700 }, unicodeRange: null },
    ] };
}

async function candidate(db, content = manifest()) {
  const text = JSON.stringify(content);
  const hash = createHash('sha256').update(text).digest('hex');
  for (const file of content.files) await db.query('INSERT INTO storage.objects VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [
    'organization-fonts', `${organizationId}/google-candidates/${hash}/${file.checksumSha256}.${file.mimeType.slice(5)}`,
    JSON.stringify({ size: file.fileSizeBytes, mimetype: file.mimeType }),
  ]);
  return [organizationId, actorId, fontId, 'Inter', cssUrl, hash, text];
}

async function commit(db, parameters) {
  return (await db.query('SELECT public.commit_google_font_candidate_bundle($1,$2,$3,$4,$5,$6,$7) AS receipt', parameters)).rows[0].receipt;
}

test('the complete migration compiles and keeps RLS and least-privilege grants', async () => {
  const db = await database();
  try {
    await db.exec(migration);
    const { rows } = await db.query(`SELECT
      has_function_privilege('anon',$1,'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated',$1,'EXECUTE') AS client_execute,
      has_function_privilege('service_role',$1,'EXECUTE') AS server_execute,
      has_table_privilege('service_role','public.organization_google_font_bundles','INSERT') AS direct_insert,
      has_table_privilege('service_role','public.organization_google_font_bundles','SELECT') AS server_read,
      (SELECT relrowsecurity FROM pg_class WHERE oid='public.organization_google_font_bundles'::regclass) AS rls`, [signature]);
    assert.deepEqual(rows[0], { anon_execute: false, client_execute: false, server_execute: true,
      direct_insert: false, server_read: true, rls: true });
  } finally { await db.close(); }
});

test('unparenthesized CASE reproduces 42601 and the transaction rolls back all candidate DDL', async () => {
  const db = await database();
  try {
    const original = migration.replace(/\(CASE WHEN ([^\r\n]+) END\)/, 'CASE WHEN $1 END');
    assert.notEqual(original, migration, 'the corrected CASE must be parenthesized');
    await assert.rejects(db.exec(original), error => error.code === '42601');
    await db.exec('ROLLBACK');
    const { rows } = await db.query("SELECT to_regclass('public.organization_google_font_bundles') AS registry");
    assert.equal(rows[0].registry, null);
  } finally { await db.close(); }
});

test('all supported MIME types create an idempotent PREPARED receipt without native authority', async () => {
  const db = await database();
  try {
    await db.exec(migration);
    for (const mimeType of ['font/woff', 'font/woff2', 'font/ttf', 'font/otf']) {
      const parameters = await candidate(db, manifest(mimeType));
      await db.exec('SET ROLE service_role');
      const first = await commit(db, parameters), replay = await commit(db, parameters);
      await db.exec('RESET ROLE');
      assert.equal(first.created, true); assert.equal(replay.created, false);
      assert.equal(first.bundleId, replay.bundleId); assert.equal(first.candidateSha256, parameters[5]);
      assert.equal(first.status, 'PREPARED'); assert.equal(first.renderEligible, false);
    }
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.organization_google_font_bundles')).rows[0].count, 4);
    assert.equal((await db.query('SELECT status FROM public.organization_slide_fonts')).rows[0].status, 'READY');
  } finally { await db.close(); }
});

test('embedding mismatch, missing Storage metadata, revoked permission and changed registry fail before commit', async () => {
  const db = await database();
  try {
    await db.exec(migration);
    const invalid = manifest(); invalid.files[0].embeddingCheck = 'ALLOWED'; invalid.faces[0].embeddingCheck = 'ALLOWED';
    await assert.rejects(commit(db, await candidate(db, invalid)), /GOOGLE_FONT_BUNDLE_INVALID/);
    const parameters = await candidate(db);
    await db.exec('DELETE FROM storage.objects');
    await assert.rejects(commit(db, parameters), /GOOGLE_FONT_BUNDLE_STORAGE_UNAVAILABLE/);
    await candidate(db);
    await db.exec("UPDATE public.organization_user_roles SET platform_role='BUILDER'");
    await assert.rejects(commit(db, parameters), /GOOGLE_FONT_BUNDLE_ACTOR_FORBIDDEN/);
    await db.exec("UPDATE public.organization_user_roles SET platform_role='ADMIN'; UPDATE public.organization_slide_fonts SET status='REJECTED'");
    await assert.rejects(commit(db, parameters), /GOOGLE_FONT_BUNDLE_REGISTRATION_CHANGED/);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.organization_google_font_bundles')).rows[0].count, 0);
  } finally { await db.close(); }
});

test('candidate content stays immutable and revoked receipts cannot be reopened or replayed', async () => {
  const db = await database();
  try {
    await db.exec(migration);
    const parameters = await candidate(db);
    await commit(db, parameters);
    await assert.rejects(db.exec("UPDATE public.organization_google_font_bundles SET registration_css_url='https://example.invalid/'"), /GOOGLE_FONT_BUNDLE_IMMUTABLE/);
    await db.exec("UPDATE public.organization_google_font_bundles SET status='REVOKED'");
    await assert.rejects(db.exec("UPDATE public.organization_google_font_bundles SET status='PREPARED'"), /GOOGLE_FONT_BUNDLE_IMMUTABLE/);
    await assert.rejects(commit(db, parameters), /GOOGLE_FONT_BUNDLE_REVOKED/);
  } finally { await db.close(); }
});

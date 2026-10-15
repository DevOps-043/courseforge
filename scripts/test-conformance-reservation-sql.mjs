import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Isolated QA runtime, following test-provided-syllabus-migration.mjs.
// Override its location with CONFORMANCE_TEST_PGLITE_PATH; no production dependency.
const root = fileURLToPath(new URL('../', import.meta.url));
const runtimePath = process.env.CONFORMANCE_TEST_PGLITE_PATH
  || path.join(root, 'apps/web/.tmp/syllabus-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(runtimePath).href);
const reservationSql = await readFile(path.join(root,
  'supabase/migrations/20261008210000_reserve_conformance_render_inputs.sql'), 'utf8');
const outboxSql = await readFile(path.join(root,
  'supabase/migrations/20261008220000_defer_conformance_render_reservations.sql'), 'utf8');

async function database() {
  const db = new PGlite();
  try {
    // Minimal prerequisites compile the actual migrations. These fixtures do not
    // certify the real authority chain or end-to-end reservation behavior.
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE SCHEMA private;
      CREATE TABLE public.hyperframes_render_requests (
        id uuid PRIMARY KEY, organization_id uuid, composition_revision_id uuid
      );
      CREATE TABLE public.video_composition_revisions (id uuid PRIMARY KEY, manifest jsonb);
      CREATE TABLE private.hyperframes_conformance_jobs (
        id uuid PRIMARY KEY, organization_id uuid, request_id uuid, revision_id uuid,
        status text, lease_token uuid, lease_expires_at timestamptz, attempt_started_at timestamptz
      );
      CREATE TABLE private.composition_render_executions (
        id uuid PRIMARY KEY, organization_id uuid, request_id uuid, revision_id uuid,
        production_job_id uuid, status text, receipt jsonb, receipt_sha256 text,
        artifact_kind text, contract jsonb, document_hash text, project_hash text, contract_sha256 text
      );
      CREATE FUNCTION public.finish_hyperframes_conformance_job(
        p_job_id uuid, p_lease_token uuid, p_report jsonb DEFAULT NULL,
        p_error_code text DEFAULT NULL, p_retryable boolean DEFAULT false
      ) RETURNS boolean LANGUAGE sql AS 'SELECT true';
    `);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

test('the complete reservation migration compiles and restricts its writer to service_role', async () => {
  const db = await database();
  try {
    await db.exec(reservationSql);
    const signature = 'public.register_hyperframes_conformance_render_reservation(uuid,uuid,uuid,uuid,text,text)';
    const { rows } = await db.query(`SELECT
      to_regclass('private.hyperframes_conformance_render_reservations') IS NOT NULL AS registry,
      to_regprocedure('private.finish_hyperframes_conformance_job_before_reservation(uuid,uuid,jsonb,text,boolean)') IS NOT NULL AS previous_finisher,
      has_function_privilege('anon', $1, 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated_execute,
      has_function_privilege('service_role', $1, 'EXECUTE') AS service_execute`, [signature]);
    assert.deepEqual(rows[0], {
      registry: true, previous_finisher: true,
      anon_execute: false, authenticated_execute: false, service_execute: true,
    });
  } finally {
    await db.close();
  }
});

test('the complete outbox migration compiles after reservations and installs its attachment trigger', async () => {
  const db = await database();
  try {
    await db.exec(reservationSql);
    await db.exec(outboxSql);
    const signature = 'public.stage_hyperframes_conformance_render_reservation(uuid,uuid,uuid,uuid,text,text)';
    const { rows } = await db.query(`SELECT
      to_regclass('private.hyperframes_conformance_render_outbox') IS NOT NULL AS outbox,
      EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='private.hyperframes_conformance_jobs'::regclass
        AND tgname='attach_conformance_outbox_after_job_insert' AND NOT tgisinternal
        AND tgenabled='O') AS attachment_trigger,
      has_function_privilege('anon', $1, 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated_execute,
      has_function_privilege('service_role', $1, 'EXECUTE') AS service_execute`, [signature]);
    assert.deepEqual(rows[0], {
      outbox: true, attachment_trigger: true,
      anon_execute: false, authenticated_execute: false, service_execute: true,
    });
  } finally {
    await db.close();
  }
});

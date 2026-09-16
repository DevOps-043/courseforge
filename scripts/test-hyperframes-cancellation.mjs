// Isolated PostgreSQL regression test. Install once with:
// npm install --prefix .tmp/render-diagnostics-qa --no-save --package-lock=false @electric-sql/pglite
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const requireQA = createRequire(new URL('../.tmp/render-diagnostics-qa/runner.cjs', import.meta.url));
const { PGlite } = requireQA('@electric-sql/pglite');
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const fixture = `CREATE SCHEMA private; CREATE SCHEMA extensions; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.production_jobs(id uuid PRIMARY KEY, organization_id uuid, status text, provider text, job_type text, progress jsonb DEFAULT '[]', completed_at timestamptz, failed_at timestamptz, updated_at timestamptz DEFAULT now(), provider_error jsonb, material_component_id uuid, artifact_id uuid, created_by uuid, output_snapshot jsonb);
CREATE TABLE public.hyperframes_render_requests(id uuid PRIMARY KEY, organization_id uuid, production_job_id uuid, provider_render_id text, provider_status text, import_status text DEFAULT 'NONE', provider_error jsonb, updated_at timestamptz DEFAULT now(), next_reconcile_at timestamptz, reconcile_lease_token uuid, reconcile_lease_expires_at timestamptz);
CREATE TABLE private.hyperframes_render_imports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), render_request_id uuid UNIQUE, status text, lease_token uuid, lease_expires_at timestamptz, last_error jsonb, updated_at timestamptz DEFAULT now(), uploaded_bytes bigint DEFAULT 0, source_size_bytes bigint, attempt_count int DEFAULT 0, failure_count int DEFAULT 0, next_attempt_at timestamptz DEFAULT now(), storage_path text, source_content_type text, storage_bucket text DEFAULT 'production-videos', completed_at timestamptz);
CREATE TABLE public.production_assets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), production_job_id uuid, asset_type text);
CREATE OR REPLACE FUNCTION private.append_production_progress(p jsonb, pct integer, stage text) RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(p,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('at',now(),'percent',pct,'stage',stage)); $$;
`;
const original = read('supabase/migrations/20260821160000_durable_hyperframes_render_orchestration.sql');
const finalizer = original.match(/CREATE OR REPLACE FUNCTION public\.complete_hyperframes_render_import\([\s\S]*?\n\$\$;/)?.[0];
assert.ok(finalizer, 'Original finalizer must be included in the regression test');
const db = new PGlite();
try {
  await db.exec(fixture + finalizer);
  await db.exec(read('supabase/migrations/20260902195000_hyperframes_render_diagnostics_and_cancellation.sql'));
  await db.exec(read('supabase/tests/hyperframes-render-cancellation.sql'));
  console.log('PASS: migration, tenant isolation, cancellation, idempotency, late writes, stale finalizer, backoff, error history and RPC permissions');
} finally { await db.close(); }

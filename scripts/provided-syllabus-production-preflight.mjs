import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

// Read-only PostgREST schema inspection. Never prints credentials or data rows.
const root = fileURLToPath(new URL('../', import.meta.url));
const environmentFile = path.join(root, 'apps/web/.env.local');
if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase configuration is missing.');
const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) throw new Error(`Schema inspection failed (HTTP ${response.status}).`);
const schema = await response.json();
const required = {
  syllabus: ['input_mode','content_version','active_import_id'],
  instructional_plans: ['upstream_dirty','syllabus_content_version'],
  curation: ['upstream_dirty','syllabus_content_version'],
  materials: ['upstream_dirty','syllabus_content_version'],
  publication_requests: ['upstream_dirty','syllabus_content_version'],
  syllabus_source_documents: ['artifact_id','extracted_text'],
  syllabus_imports: ['artifact_id','confirmed_revision'],
};
for (const [table, columns] of Object.entries(required)) {
  const properties = schema.definitions?.[table]?.properties;
  process.stdout.write(`${table}: ${properties ? 'present' : 'not visible'}; missing required fields: ${columns.filter(column => !properties?.[column]).join(', ') || 'none'}\n`);
}
process.stdout.write('PostgREST introspection does not verify effective pg_policies or grant SQL migration access.\n');

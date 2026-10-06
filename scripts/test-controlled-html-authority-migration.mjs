import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Lexical guards only: not PostgreSQL syntax/locks/RLS/concurrency validation.
const source = readFileSync(new URL("../supabase/migrations/20261005230000_controlled_html_editing_authority.sql", import.meta.url), "utf8");
for (const required of [
  "SECURITY DEFINER SET search_path = pg_catalog,public,private",
  "p_worker_lease_token IS NULL",
  "private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token)",
  "organization_id = p_organization_id AND status = 'RUNNING' AND lease_token = p_worker_lease_token FOR SHARE",
  "r.production_job_id IS DISTINCT FROM p_production_job_id",
  "r.composition_revision_id IS DISTINCT FROM p_revision_id",
  "r.cancelled_at IS NOT NULL",
  "j.created_by IS NULL",
  "j.input_snapshot->>'revision_id' IS DISTINCT FROM v.id::text",
  "j.input_snapshot->>'project_hash' IS DISTINCT FROM v.project_hash",
  "v.manifest->>'draft_document_hash' IS DISTINCT FROM p_document_hash",
  "v.manifest->>'draft_document_id'",
  "e.contract IS DISTINCT FROM v.manifest->'conformance_contract'",
  "e.issuance_id IS DISTINCT FROM q.issuance_id",
  "e.supervisor_id IS DISTINCT FROM q.supervisor_id",
  "e.key_id IS DISTINCT FROM q.key_id",
  "e.expires_at_ms <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint",
  "AND supervisor_id = e.supervisor_id AND key_id = e.key_id AND NOT revoked",
  "AND composition_id = v.composition_id AND state = 'ACTIVE' FOR SHARE",
  "public.read_html_editing_compilation(p_organization_id,resolved_draft_id,j.created_by,p_document_hash)",
  "l.draft_id = resolved_draft_id AND l.organization_id = p_organization_id AND a.organization_id = p_organization_id",
  "jsonb_array_elements_text(entry->'grantedAssetIds') granted(id) WHERE granted.id = a.id::text",
  "ORDER BY a.id FOR SHARE OF l,a",
  "'checksum',image_record.checksum,'fileSizeBytes',image_record.file_size_bytes,'mimeType',image_record.mime_type",
  "'storageBucket',image_record.storage_bucket,'storagePath',image_record.storage_path",
  "'imageAssets',image_assets",
  "octet_length(result::text) > 16777216",
  "FROM PUBLIC,anon,authenticated",
  "TO service_role",
]) assert.ok(source.includes(required), `Missing prepared guard: ${required}`);
assert.equal(source.match(/PERFORM private\.assert_controlled_render_worker_lease\(/g)?.length, 2);
assert.ok(!source.includes("p_actor_id"), "Actor must come from stored job, not host/request input");
assert.ok(!source.includes("p_draft_id"), "Draft must come from stored revision, not ZIP/host input");
assert.ok(!source.includes("CREATE TRIGGER"));
const snapshotSource = readFileSync(new URL("../apps/web/src/domains/production/composition-editor/composition-snapshot.service.ts", import.meta.url), "utf8");
const revisionInsert = snapshotSource.match(/\.from\("video_composition_revisions"\)\.insert\(\{([\s\S]*?)\}\)\.select/);
assert.ok(revisionInsert, "Snapshot must contain its revision persistence block");
assert.ok(revisionInsert[1].includes("draft_document_id: params.draftId"), "Draft identity must be persisted, not only filtered in reuse query");
console.info("Controlled HTML authority: 35 lexical guards pass; migration not applied or validated in PostgreSQL.");

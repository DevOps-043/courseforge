import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261010210000_google_font_candidate_bundles.sql"), "utf8");
test("candidate migration restricts writes to the authenticated server RPC, not clients or direct service writes", () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.organization_google_font_bundles FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.organization_google_font_bundles TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.commit_google_font_candidate_bundle\(uuid,uuid,uuid,text,text,text,text\) TO service_role/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE|ALL) ON TABLE/);
});
test("commit reauthorizes live admin and binds tenant/registration/objects under bounded locks", () => {
  for (const required of ["SET lock_timeout = '2s'", "r.platform_role::text IN ('ADMIN','SUPERADMIN')",
    "p.is_active IS TRUE AND o.is_active IS TRUE FOR SHARE OF r,p,o", "f.id=p_font AND f.organization_id=p_org FOR SHARE",
    "font.family IS DISTINCT FROM p_family", "font.css_url IS DISTINCT FROM p_css_url", "font.source IS DISTINCT FROM 'google'",
    "bucket_id='organization-fonts' AND name=object_path FOR SHARE", "object_record.metadata->>'size'",
    "object_record.metadata->>'mimetype'"]) assert.ok(migration.includes(required), required);
});
test("immutable canonical metadata is an idempotent prepared receipt, not native READY authorization", () => {
  for (const required of ["UNIQUE (organization_id,font_id,candidate_sha256)", "manifest = manifest_text::jsonb",
    "pg_catalog.sha256(convert_to(manifest_text,'UTF8'))", "GOOGLE_FONT_BUNDLE_IMMUTABLE", "GOOGLE_FONT_BUNDLE_REVOKED",
    "ON CONFLICT (organization_id,font_id,candidate_sha256) DO NOTHING", "'renderEligible',false", "'status','PREPARED'"]) assert.ok(migration.includes(required), required);
  assert.doesNotMatch(migration, /UPDATE public\.organization_slide_fonts|html_snapshot_resource_bindings|apply_video_composition_agent_proposal/);
});

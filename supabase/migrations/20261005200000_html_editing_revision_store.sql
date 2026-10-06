-- PREPARED ONLY: no template registration, endpoint, flag or migration activation.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.composition_html_templates (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  clip_id text NOT NULL CHECK (clip_id ~ '^[a-zA-Z][a-zA-Z0-9_-]{0,95}$'),
  initial_revision jsonb NOT NULL CHECK (octet_length(initial_revision::text) <= 1048576),
  revoked boolean NOT NULL DEFAULT false,
  PRIMARY KEY (draft_id,clip_id)
);
CREATE TABLE private.composition_html_revisions (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  draft_id uuid NOT NULL, clip_id text NOT NULL,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 1000000),
  revision jsonb NOT NULL CHECK (octet_length(revision::text) <= 1048576),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id,clip_id,version),
  FOREIGN KEY (draft_id,clip_id) REFERENCES private.composition_html_templates(draft_id,clip_id)
);
ALTER TABLE private.composition_html_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.composition_html_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_html_templates,private.composition_html_revisions FROM PUBLIC,anon,authenticated,service_role;

-- Explicit tenant membership, active actor/organization and current reviewer role.
-- No global-role fallback or caller-supplied organization as authorization.
CREATE FUNCTION private.assert_html_editing_actor(p_organization_id uuid,p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
BEGIN
  PERFORM 1 FROM public.organization_user_roles r
    JOIN public.profiles p ON p.id = r.user_id JOIN public.organizations o ON o.id = r.organization_id
    WHERE r.user_id = p_actor_id AND r.organization_id = p_organization_id
      AND r.platform_role::text IN ('ADMIN','ARQUITECTO','SUPERADMIN') AND p.is_active IS TRUE AND o.is_active IS TRUE
    FOR SHARE OF r,p,o;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_ACTOR_FORBIDDEN'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.assert_html_editing_actor(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.html_editing_grants(p_organization_id uuid,p_draft_id uuid,p_revision jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE result jsonb := '[]'::jsonb; asset record;
BEGIN
  -- Stable lock order prevents concurrent link deletion/asset revocation during append.
  FOR asset IN SELECT a.id FROM public.video_composition_draft_assets l JOIN public.production_assets a ON a.id = l.production_asset_id
    WHERE l.draft_id = p_draft_id AND l.organization_id = p_organization_id AND a.organization_id = p_organization_id
      AND a.mime_type IN ('image/png','image/jpeg','image/webp') AND a.file_size_bytes BETWEEN 1 AND 33554432
      AND a.checksum ~ '^[a-f0-9]{64}$' AND a.storage_bucket IS NOT NULL AND a.storage_path IS NOT NULL
      AND a.qa_status IN ('GENERATED','READY_FOR_QA','APPROVED','EXPORTED','PUBLISHED')
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_revision#>'{manifest,elements}') e,
        jsonb_array_elements_text(CASE WHEN e->>'kind' = 'IMAGE' THEN e->'allowedAssetIds' ELSE '[]'::jsonb END) allowed(id)
        WHERE allowed.id = a.id::text)
    ORDER BY a.id FOR SHARE OF l,a
  LOOP result := result || jsonb_build_array(asset.id::text); END LOOP;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.html_editing_grants(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.register_html_editing_template(p_organization_id uuid,p_draft_id uuid,p_actor_id uuid,
  p_clip_id text,p_expected_document_hash text,p_revision jsonb,p_revision_sha256 text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE d public.video_composition_draft_documents%ROWTYPE; source_clip jsonb; template private.composition_html_templates%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id AND organization_id = p_organization_id AND state = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  SELECT * INTO d FROM public.video_composition_draft_documents WHERE draft_id = p_draft_id AND organization_id = p_organization_id ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR d.document_hash IS DISTINCT FROM p_expected_document_hash THEN RAISE EXCEPTION 'HTML_EDITING_REVISION_CONFLICT'; END IF;
  SELECT c INTO source_clip FROM jsonb_array_elements(d.document->'clips') c WHERE c->>'id' = p_clip_id;
  IF source_clip IS NULL OR source_clip->>'kind' IS DISTINCT FROM 'DECK_SLIDE' OR source_clip#>>'{source,type}' IS DISTINCT FROM 'DECK_SLIDE'
    OR source_clip#>>'{source,html}' IS DISTINCT FROM p_revision->>'sourceHtml'
    OR p_revision->>'format' IS DISTINCT FROM 'courseforge-html-editable-revision-v1' OR p_revision->>'version' IS DISTINCT FROM '1'
    OR p_revision#>>'{manifest,binding,organizationId}' IS DISTINCT FROM p_organization_id::text
    OR p_revision#>>'{manifest,binding,documentId}' IS DISTINCT FROM p_draft_id::text
    OR p_revision#>>'{manifest,binding,clipId}' IS DISTINCT FROM p_clip_id
    OR p_revision#>>'{manifest,binding,documentSha256}' IS DISTINCT FROM d.document_hash
    OR p_revision#>'{state,binding}' IS DISTINCT FROM p_revision#>'{manifest,binding}'
    OR p_revision#>'{state,overrides}' IS DISTINCT FROM '[]'::jsonb
    OR p_revision_sha256 IS NULL OR p_revision_sha256 !~ '^[a-f0-9]{64}$'
    OR octet_length(p_revision::text) > 1048576 THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_revisions r JOIN public.video_composition_drafts draft ON draft.composition_id = r.composition_id
    WHERE draft.id = p_draft_id AND r.organization_id = p_organization_id
      AND r.id::text = p_revision#>>'{manifest,binding,revisionId}' FOR SHARE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  SELECT * INTO template FROM private.composition_html_templates WHERE draft_id = p_draft_id AND clip_id = p_clip_id FOR UPDATE;
  IF FOUND THEN
    IF template.organization_id <> p_organization_id OR template.revoked OR template.initial_revision IS DISTINCT FROM p_revision THEN
      RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_CONFLICT';
    END IF;
    RETURN false;
  END IF;
  INSERT INTO private.composition_html_templates(organization_id,draft_id,clip_id,initial_revision) VALUES(p_organization_id,p_draft_id,p_clip_id,p_revision);
  INSERT INTO private.composition_html_revisions(organization_id,draft_id,clip_id,version,revision,sha256,created_by)
    VALUES(p_organization_id,p_draft_id,p_clip_id,1,p_revision,p_revision_sha256,p_actor_id);
  RETURN true;
END $$;

CREATE FUNCTION public.read_html_editing_revision(p_organization_id uuid,p_draft_id uuid,p_clip_id text,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE d public.video_composition_draft_documents%ROWTYPE; t private.composition_html_templates%ROWTYPE;
  r private.composition_html_revisions%ROWTYPE; source_clip jsonb; reference jsonb;
BEGIN
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id AND organization_id = p_organization_id AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  SELECT * INTO t FROM private.composition_html_templates WHERE draft_id = p_draft_id AND clip_id = p_clip_id AND organization_id = p_organization_id AND NOT revoked FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  SELECT * INTO d FROM public.video_composition_draft_documents WHERE draft_id = p_draft_id AND organization_id = p_organization_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO r FROM private.composition_html_revisions WHERE draft_id = p_draft_id AND clip_id = p_clip_id AND organization_id = p_organization_id ORDER BY version DESC LIMIT 1;
  SELECT c INTO source_clip FROM jsonb_array_elements(d.document->'clips') c WHERE c->>'id' = p_clip_id;
  SELECT item INTO reference FROM jsonb_array_elements(coalesce(d.document#>'{htmlEditing,items}','[]'::jsonb)) item WHERE item->>'clipId' = p_clip_id;
  IF d.id IS NULL OR r.draft_id IS NULL OR source_clip#>>'{source,type}' IS DISTINCT FROM 'DECK_SLIDE'
    OR source_clip#>>'{source,html}' IS DISTINCT FROM t.initial_revision->>'sourceHtml'
    OR (reference IS NULL AND r.version <> 1)
    OR (reference IS NOT NULL AND (reference->>'revisionVersion' IS DISTINCT FROM r.version::text OR reference->>'revisionSha256' IS DISTINCT FROM r.sha256))
    THEN RAISE EXCEPTION 'HTML_EDITING_REFERENCE_INVALID'; END IF;
  RETURN jsonb_build_object('revision',r.revision,'revisionSha256',r.sha256,'document',d.document,
    'compositionDocumentHash',d.document_hash,'grantedAssetIds',private.html_editing_grants(p_organization_id,p_draft_id,t.initial_revision));
END $$;
CREATE FUNCTION public.revoke_html_editing_template(p_organization_id uuid,p_draft_id uuid,p_clip_id text,p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
BEGIN
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  UPDATE private.composition_html_templates SET revoked = true
    WHERE draft_id = p_draft_id AND clip_id = p_clip_id AND organization_id = p_organization_id AND NOT revoked;
  RETURN FOUND; -- Monotonic/idempotent revocation; original/history rows remain intact.
END $$;
REVOKE ALL ON FUNCTION public.register_html_editing_template(uuid,uuid,uuid,text,text,jsonb,text),
  public.read_html_editing_revision(uuid,uuid,text,uuid),public.revoke_html_editing_template(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_html_editing_template(uuid,uuid,uuid,text,text,jsonb,text),
  public.read_html_editing_revision(uuid,uuid,text,uuid),public.revoke_html_editing_template(uuid,uuid,text,uuid) TO service_role;
COMMENT ON TABLE private.composition_html_revisions IS 'Prepared immutable HTML subdocument history; server must verify canonical digest/source before all service-only RPCs. No browser or render rollout.';
COMMIT;

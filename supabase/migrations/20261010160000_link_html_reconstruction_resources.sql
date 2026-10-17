-- PREPARED ONLY. Requires selection helpers (step25), opening and base draft links.
-- Explicit link to NEW independent draft only; no native, original, asset, Storage
-- or active-revision mutation. A receipt is historical evidence, not a live grant.
BEGIN;
CREATE TABLE private.composition_html_reconstruction_resource_links (
  organization_id uuid NOT NULL REFERENCES public.organizations(id), operation_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id), draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK (octet_length(receipt::text) <= 8192), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,operation_id)
);
ALTER TABLE private.composition_html_reconstruction_resource_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_html_reconstruction_resource_links FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.html_reconstruction_resource_link_command(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,
  p_operation uuid,p_request jsonb,p_request_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE digest text;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_composition IS NULL OR p_draft IS NULL OR p_operation IS NULL
    OR jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::text) > 1024
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_RESOURCE_LINK_INVALID'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_request)) <> 5
    OR coalesce(p_request->>'assetId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    OR coalesce(p_request->>'resourceIdentitySha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(p_request->>'expectedDocumentHash','') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_request->'expectedVersion') IS DISTINCT FROM 'number'
    OR coalesce(p_request->>'expectedVersion','') !~ '^[1-9][0-9]{0,9}$'
    OR (p_request->>'expectedVersion')::bigint > 2147483647
    OR p_request->'confirmedResourceOnly' IS DISTINCT FROM 'true'::jsonb
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_RESOURCE_LINK_INVALID'; END IF;
  digest := encode(pg_catalog.sha256(convert_to(concat_ws(chr(10),'courseforge-html-reconstruction-resource-link-v1',
    p_org::text,p_actor::text,p_composition::text,p_draft::text,p_operation::text,p_request->>'assetId',
    p_request->>'resourceIdentitySha256',p_request->>'expectedDocumentHash',p_request->>'expectedVersion','true'),'UTF8')),'hex');
  IF digest IS DISTINCT FROM p_request_sha256 THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_RESOURCE_LINK_INVALID'; END IF;
  RETURN jsonb_build_object('actorId',p_actor,'organizationId',p_org,'compositionId',p_composition,'draftId',p_draft,
    'operationId',p_operation,'request',p_request);
END $$;
REVOKE ALL ON FUNCTION private.html_reconstruction_resource_link_command(uuid,uuid,uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.link_html_reconstruction_resource(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,
  p_operation uuid,p_request jsonb,p_request_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE opening jsonb; command jsonb; asset public.production_assets%ROWTYPE; previous jsonb; receipt jsonb; linked boolean; link_role text; rejection_reason text;
BEGIN
  -- Serialize allocation with native mutations and other resource-link operations.
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft AND organization_id = p_org
    AND composition_id = p_composition AND state = 'ACTIVE' FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_RESOURCE_LINK_CONFLICT'; END IF;
  opening := public.read_html_reconstruction_opening(p_org,p_actor,p_composition,p_draft);
  command := private.html_reconstruction_resource_link_command(p_org,p_actor,p_composition,p_draft,p_operation,p_request,p_request_sha256);
  SELECT r.receipt INTO previous FROM private.composition_html_reconstruction_resource_links r
    WHERE r.organization_id = p_org AND r.operation_id = p_operation FOR SHARE;
  IF FOUND THEN
    IF previous->'command' IS DISTINCT FROM command OR previous->>'requestSha256' IS DISTINCT FROM p_request_sha256
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_RESOURCE_LINK_CONFLICT'; END IF;
    RETURN previous;
  END IF;
  IF opening->>'currentDocumentHash' IS DISTINCT FROM p_request->>'expectedDocumentHash'
    OR (opening->>'currentVersion')::integer IS DISTINCT FROM (p_request->>'expectedVersion')::integer
    THEN rejection_reason := 'BASE_CHANGED'; END IF;
  IF rejection_reason IS NULL THEN
    SELECT * INTO asset FROM public.production_assets WHERE id = (p_request->>'assetId')::uuid AND organization_id = p_org FOR SHARE;
    IF NOT FOUND OR private.html_reconstruction_resource_eligible(asset) IS DISTINCT FROM true
      OR private.html_reconstruction_resource_identity(asset) IS DISTINCT FROM p_request->>'resourceIdentitySha256'
      THEN rejection_reason := 'RESOURCE_CHANGED'; END IF;
  END IF;
  IF rejection_reason IS NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.video_composition_draft_assets WHERE draft_id = p_draft
      AND organization_id = p_org AND production_asset_id = asset.id) INTO linked;
    IF NOT linked AND (SELECT count(*) FROM (SELECT 1 FROM public.video_composition_draft_assets
      WHERE draft_id = p_draft AND organization_id = p_org LIMIT 250) bounded) >= 250 THEN rejection_reason := 'LIMIT'; END IF;
  END IF;
  IF rejection_reason IS NULL AND NOT linked THEN
    link_role := private.html_reconstruction_resource_metadata(asset,NULL)->>'timelineRole';
    INSERT INTO public.video_composition_draft_assets(draft_id,production_asset_id,organization_id,role,source_reference)
      VALUES(p_draft,asset.id,p_org,link_role,'HTML_RECONSTRUCTION_EXPLICIT_RESOURCE')
      ON CONFLICT (draft_id,production_asset_id) DO NOTHING;
  END IF;
  -- An existing/cross-tenant poisoned unique row cannot issue a false receipt.
  IF rejection_reason IS NULL THEN
    PERFORM 1 FROM public.video_composition_draft_assets WHERE draft_id = p_draft AND organization_id = p_org
      AND production_asset_id = asset.id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_RESOURCE_LINK_CONFLICT'; END IF;
  END IF;
  receipt := jsonb_build_object('scope','RESOURCE_LINK_RECEIPT_NOT_CURRENT_GRANT_OR_PUBLICATION','command',command,
    'requestSha256',p_request_sha256,'resourceLinked',rejection_reason IS NULL,'rejectionReason',rejection_reason,
    'nativeDocumentChanged',false,'originalDraftChanged',false);
  INSERT INTO private.composition_html_reconstruction_resource_links(organization_id,operation_id,actor_id,draft_id,request_sha256,receipt)
    VALUES(p_org,p_operation,p_actor,p_draft,p_request_sha256,receipt);
  RETURN receipt;
END $$;

CREATE FUNCTION public.read_html_reconstruction_resource_link(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,
  p_operation uuid,p_request jsonb,p_request_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE command jsonb; receipt jsonb;
BEGIN
  PERFORM public.read_html_reconstruction_opening(p_org,p_actor,p_composition,p_draft);
  command := private.html_reconstruction_resource_link_command(p_org,p_actor,p_composition,p_draft,p_operation,p_request,p_request_sha256);
  SELECT r.receipt INTO receipt FROM private.composition_html_reconstruction_resource_links r
    WHERE r.organization_id = p_org AND r.operation_id = p_operation FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  IF receipt->'command' IS DISTINCT FROM command OR receipt->>'requestSha256' IS DISTINCT FROM p_request_sha256
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_RESOURCE_LINK_CONFLICT'; END IF;
  RETURN jsonb_build_object('status','RECORDED','receipt',receipt);
END $$;
REVOKE ALL ON FUNCTION public.link_html_reconstruction_resource(uuid,uuid,uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_html_reconstruction_resource_link(uuid,uuid,uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.link_html_reconstruction_resource(uuid,uuid,uuid,uuid,uuid,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_html_reconstruction_resource_link(uuid,uuid,uuid,uuid,uuid,jsonb,text) TO service_role;
COMMIT;

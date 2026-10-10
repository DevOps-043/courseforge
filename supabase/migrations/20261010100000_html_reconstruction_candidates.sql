-- PREPARED ONLY. Requires reconstruction review and snapshot resource readers.
-- No application/flags/routes/catalog activation or Storage writes here.
BEGIN;
CREATE TABLE private.composition_html_reconstruction_staging (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  operation_id uuid NOT NULL, candidate_id uuid NOT NULL, reviewer_id uuid NOT NULL REFERENCES public.profiles(id),
  staging jsonb NOT NULL CHECK (octet_length(staging::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,operation_id), UNIQUE(organization_id,candidate_id),
  FOREIGN KEY(organization_id,candidate_id) REFERENCES private.composition_html_reconstruction_reviews(organization_id,candidate_id)
);
CREATE TABLE private.composition_html_reconstruction_candidates (
  organization_id uuid NOT NULL, operation_id uuid NOT NULL,
  candidate jsonb NOT NULL CHECK (octet_length(candidate::text) <= 16777216),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,operation_id),
  FOREIGN KEY(organization_id,operation_id) REFERENCES private.composition_html_reconstruction_staging(organization_id,operation_id)
);
ALTER TABLE private.composition_html_reconstruction_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.composition_html_reconstruction_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_html_reconstruction_staging,private.composition_html_reconstruction_candidates
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.assert_html_reconstruction_staging(p_org uuid,p_actor uuid,p_staging jsonb,p_require_review boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE review private.composition_html_reconstruction_reviews%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_staging) IS DISTINCT FROM 'object' OR octet_length(p_staging::text) > 4096
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_STAGING_INVALID'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_staging)) <> 5
    OR p_staging->>'scope' IS DISTINCT FROM 'RECONSTRUCTION_STAGING_NOT_CREATION_OR_PUBLICATION'
    OR coalesce(p_staging->>'operationId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    OR jsonb_typeof(p_staging->'operationId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_staging->'candidateSha256') IS DISTINCT FROM 'string'
    OR coalesce(p_staging->>'candidateSha256','') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_staging->'archiveSizeBytes') IS DISTINCT FROM 'number'
    OR coalesce(p_staging->>'archiveSizeBytes','') !~ '^[0-9]{1,9}$'
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_STAGING_INVALID'; END IF;
  IF (p_staging->>'archiveSizeBytes')::bigint NOT BETWEEN 1 AND 209715200 THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_STAGING_INVALID'; END IF;
  PERFORM private.assert_html_reconstruction_review(p_org,p_actor,p_staging->'review');
  IF p_require_review THEN
    SELECT * INTO review FROM private.composition_html_reconstruction_reviews
      WHERE organization_id = p_org AND candidate_id = (p_staging#>>'{review,locator,candidateId}')::uuid FOR SHARE;
    IF NOT FOUND OR review.revoked OR review.reviewer_id IS DISTINCT FROM p_actor OR review.record IS DISTINCT FROM p_staging->'review'
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_REVIEW_UNAVAILABLE'; END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.assert_html_reconstruction_staging(uuid,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- Host verifies full strict schemas, canonical digests, installed catalog and
-- sealed producer metadata. SQL rechecks identity/source/pointers/grants under
-- locks; the saved historical native/HTML is never compiled or transplanted.
CREATE FUNCTION private.validate_html_reconstruction_candidate(p_org uuid,p_actor uuid,p_staging jsonb,p_candidate jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE content jsonb; proposed jsonb; document jsonb; manifest jsonb; archive jsonb; locator jsonb;
  initial jsonb; revision jsonb; binding jsonb; pointer jsonb; clip jsonb; grants jsonb; bindings jsonb;
BEGIN
  PERFORM private.assert_html_reconstruction_staging(p_org,p_actor,p_staging,true);
  IF jsonb_typeof(p_candidate) IS DISTINCT FROM 'object' OR octet_length(p_candidate::text) > 16777216
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_CANDIDATE_INVALID'; END IF;
  content := p_candidate->'content'; proposed := content->'candidate'; document := proposed->'document';
  manifest := p_candidate#>'{registration,manifest}'; archive := p_candidate#>'{registration,archive}'; locator := p_staging#>'{review,locator}';
  IF p_candidate->>'scope' IS DISTINCT FROM 'RECONSTRUCTION_CANDIDATE_NOT_CREATED_OR_PUBLISHED'
    OR p_candidate->'review' IS DISTINCT FROM p_staging->'review'
    OR p_candidate->>'candidateSha256' IS DISTINCT FROM p_staging->>'candidateSha256'
    OR content->>'scope' IS DISTINCT FROM 'PREPARED_RECONSTRUCTED_ARCHIVE_NOT_APPROVED_CREATED_OR_PUBLISHED'
    OR proposed->>'scope' IS DISTINCT FROM 'PREPARED_NEW_CONTENT_NOT_HISTORICAL_REPUBLICATION_OR_APPROVAL'
    OR proposed->'origin' IS DISTINCT FROM p_staging#>'{review,origin}'
    OR proposed->'requiredReviews' IS DISTINCT FROM p_staging#>'{review,approval,completedReviews}'
    OR proposed#>>'{target,compositionId}' IS DISTINCT FROM locator->>'targetCompositionId'
    OR proposed#>>'{target,documentId}' IS DISTINCT FROM locator->>'targetDocumentId'
    OR proposed#>>'{target,revisionId}' IS DISTINCT FROM locator->>'targetRevisionId'
    OR document->>'format' IS DISTINCT FROM 'courseforge-composition-v4'
    OR document->'deckStyles' IS DISTINCT FROM 'null'::jsonb
    OR coalesce(proposed->>'documentHash','') !~ '^[a-f0-9]{64}$'
    OR content#>>'{prepared,documentHash}' IS DISTINCT FROM proposed->>'documentHash'
    OR manifest->>'draft_document_hash' IS DISTINCT FROM proposed->>'documentHash'
    OR manifest->>'draft_document_id' IS DISTINCT FROM locator->>'targetDocumentId'
    OR manifest->'snapshot' IS DISTINCT FROM 'true'::jsonb
    OR manifest->'conformance_contract_version' IS DISTINCT FROM '4'::jsonb
    OR manifest#>>'{conformance_contract,schemaVersion}' IS DISTINCT FROM '4'
    OR manifest#>>'{conformance_contract,documentHash}' IS DISTINCT FROM proposed->>'documentHash'
    OR manifest#>>'{conformance_contract,renderExecution,backend}' IS DISTINCT FROM 'CONTROLLED'
    OR content#>>'{prepared,projectHash}' IS DISTINCT FROM locator->>'projectHash'
    OR archive->>'projectHash' IS DISTINCT FROM locator->>'projectHash'
    OR archive->>'sizeBytes' IS DISTINCT FROM p_staging->>'archiveSizeBytes'
    OR archive->>'storageBucket' IS DISTINCT FROM 'production-assets'
    OR archive->>'storagePath' IS DISTINCT FROM 'composition-snapshots/'||p_org::text||'/'||
      (locator->>'targetCompositionId')||'/'||(locator->>'projectHash')||'.zip'
    OR manifest->'asset_manifest' IS DISTINCT FROM content#>'{prepared,assets}'
    OR manifest->'font_manifest' IS DISTINCT FROM content#>'{prepared,fontManifest}'
    OR manifest->'conformance_contract' IS DISTINCT FROM content#>'{prepared,contract}'
    OR manifest->'conformance_reference' IS DISTINCT FROM content#>'{prepared,metadata}'
    OR manifest->'html_editing_snapshot' IS DISTINCT FROM content#>'{prepared,metadata,htmlEditingSnapshot}'
    OR manifest#>>'{html_editing_snapshot,sha256}' IS DISTINCT FROM content#>>'{prepared,bundle,sha256}'
    OR manifest#>>'{html_editing_snapshot,path}' IS DISTINCT FROM 'html-editing-revisions.json'
    OR jsonb_typeof(document->'clips') IS DISTINCT FROM 'array'
    OR jsonb_typeof(document#>'{htmlEditing,items}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(proposed->'initialRevisions') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_CANDIDATE_INVALID'; END IF;
  IF jsonb_array_length(proposed->'initialRevisions') NOT BETWEEN 1 AND 200
    OR jsonb_array_length(proposed->'initialRevisions') <> jsonb_array_length(document#>'{htmlEditing,items}')
    OR jsonb_array_length(proposed->'initialRevisions') <> (SELECT count(DISTINCT e->>'clipId') FROM jsonb_array_elements(proposed->'initialRevisions') e)
    OR jsonb_array_length(proposed->'initialRevisions') <> (SELECT count(*) FROM jsonb_array_elements(document->'clips') c WHERE c#>>'{source,type}' = 'DECK_SLIDE')
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_POINTERS_INVALID'; END IF;
  bindings := private.html_snapshot_resource_bindings(p_org,(locator->>'sourceDraftId')::uuid,manifest->'asset_manifest',manifest->'font_manifest');
  FOR initial IN SELECT e FROM jsonb_array_elements(proposed->'initialRevisions') e LOOP
    revision := initial->'revision'; binding := revision#>'{manifest,binding}';
    SELECT e INTO pointer FROM jsonb_array_elements(document#>'{htmlEditing,items}') e WHERE e->>'clipId' = initial->>'clipId';
    SELECT e INTO clip FROM jsonb_array_elements(document->'clips') e WHERE e->>'id' = initial->>'clipId';
    IF pointer IS NULL OR clip IS NULL OR clip->>'kind' IS DISTINCT FROM 'DECK_SLIDE'
      OR clip#>>'{source,html}' IS DISTINCT FROM revision->>'sourceHtml'
      OR revision->>'format' IS DISTINCT FROM 'courseforge-html-editable-revision-v1'
      OR revision->'version' IS DISTINCT FROM '1'::jsonb OR revision#>'{state,overrides}' IS DISTINCT FROM '[]'::jsonb
      OR revision#>'{state,binding}' IS DISTINCT FROM binding OR octet_length(revision::text) > 1048576
      OR binding->>'organizationId' IS DISTINCT FROM p_org::text
      OR binding->>'documentId' IS DISTINCT FROM locator->>'targetDocumentId'
      OR binding->>'revisionId' IS DISTINCT FROM locator->>'targetRevisionId'
      OR binding->>'clipId' IS DISTINCT FROM initial->>'clipId'
      OR pointer->>'revisionSha256' IS DISTINCT FROM initial->>'revisionSha256'
      OR pointer->'revisionVersion' IS DISTINCT FROM '1'::jsonb
      OR pointer->>'templateId' IS DISTINCT FROM binding->>'templateId'
      OR pointer->'templateVersion' IS DISTINCT FROM binding->'templateVersion'
      OR pointer->>'sourceSha256' IS DISTINCT FROM binding->>'sourceSha256'
      OR pointer->>'manifestSha256' IS DISTINCT FROM binding->>'manifestSha256'
      OR jsonb_typeof(initial->'usedAssetIds') IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_POINTERS_INVALID'; END IF;
    grants := private.html_editing_grants(p_org,(locator->>'sourceDraftId')::uuid,revision);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(initial->'usedAssetIds') used(id) WHERE NOT (grants ? used.id)
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(bindings) b WHERE b->>'productionAssetId' = used.id
        AND b->>'origin' = 'PRODUCTION' AND b->>'mimeType' IN ('image/png','image/jpeg','image/webp')))
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_HTML_GRANT_REVOKED'; END IF;
  END LOOP;
  RETURN bindings;
END $$;
REVOKE ALL ON FUNCTION private.validate_html_reconstruction_candidate(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.record_html_reconstruction_staging(p_org uuid,p_actor uuid,p_staging jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE stored private.composition_html_reconstruction_staging%ROWTYPE; inserted integer;
BEGIN
  PERFORM private.assert_html_reconstruction_staging(p_org,p_actor,p_staging,true);
  IF EXISTS (SELECT 1 FROM public.video_compositions WHERE id = (p_staging#>>'{review,locator,targetCompositionId}')::uuid)
    OR EXISTS (SELECT 1 FROM public.video_composition_drafts WHERE id = (p_staging#>>'{review,locator,targetDocumentId}')::uuid)
    OR EXISTS (SELECT 1 FROM public.video_composition_revisions WHERE id = (p_staging#>>'{review,locator,targetRevisionId}')::uuid)
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_TARGET_EXISTS'; END IF;
  INSERT INTO private.composition_html_reconstruction_staging(organization_id,operation_id,candidate_id,reviewer_id,staging)
    VALUES(p_org,(p_staging->>'operationId')::uuid,(p_staging#>>'{review,locator,candidateId}')::uuid,p_actor,p_staging)
    ON CONFLICT (organization_id,operation_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  SELECT * INTO stored FROM private.composition_html_reconstruction_staging
    WHERE organization_id = p_org AND operation_id = (p_staging->>'operationId')::uuid FOR SHARE;
  IF stored.staging IS DISTINCT FROM p_staging OR stored.reviewer_id IS DISTINCT FROM p_actor
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_STAGING_CONFLICT'; END IF;
  RETURN jsonb_build_object('staging',stored.staging,'created',inserted = 1);
END $$;

CREATE FUNCTION public.record_html_reconstruction_candidate(p_org uuid,p_actor uuid,p_staging jsonb,p_candidate jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE stored jsonb; inserted integer;
BEGIN
  PERFORM private.validate_html_reconstruction_candidate(p_org,p_actor,p_staging,p_candidate);
  PERFORM 1 FROM private.composition_html_reconstruction_staging WHERE organization_id = p_org
    AND operation_id = (p_staging->>'operationId')::uuid AND reviewer_id = p_actor AND staging = p_staging FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_STAGING_REQUIRED'; END IF;
  INSERT INTO private.composition_html_reconstruction_candidates(organization_id,operation_id,candidate)
    VALUES(p_org,(p_staging->>'operationId')::uuid,p_candidate) ON CONFLICT (organization_id,operation_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  SELECT candidate INTO stored FROM private.composition_html_reconstruction_candidates
    WHERE organization_id = p_org AND operation_id = (p_staging->>'operationId')::uuid FOR SHARE;
  IF stored IS DISTINCT FROM p_candidate THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_CANDIDATE_CONFLICT'; END IF;
  RETURN inserted = 1;
END $$;

CREATE FUNCTION public.read_html_reconstruction_staging(p_org uuid,p_actor uuid,p_staging jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE stored private.composition_html_reconstruction_staging%ROWTYPE; status text;
BEGIN
  -- Reconciliation remains possible after withdrawal, not creation authority.
  PERFORM private.assert_html_reconstruction_staging(p_org,p_actor,p_staging,false);
  SELECT * INTO stored FROM private.composition_html_reconstruction_staging WHERE organization_id = p_org
    AND operation_id = (p_staging->>'operationId')::uuid FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  IF stored.staging IS DISTINCT FROM p_staging OR stored.reviewer_id IS DISTINCT FROM p_actor
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_STAGING_CONFLICT'; END IF;
  status := CASE WHEN EXISTS (SELECT 1 FROM private.composition_html_reconstruction_candidates
    WHERE organization_id = p_org AND operation_id = stored.operation_id) THEN 'RECORDED' ELSE 'CLAIM_RECORDED_CANDIDATE_UNCONFIRMED' END;
  RETURN jsonb_build_object('status',status,'staging',stored.staging);
END $$;

CREATE FUNCTION public.read_html_reconstruction_candidate(p_org uuid,p_actor uuid,p_staging jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE stored jsonb;
BEGIN
  PERFORM private.assert_html_reconstruction_staging(p_org,p_actor,p_staging,true);
  PERFORM 1 FROM private.composition_html_reconstruction_staging WHERE organization_id = p_org
    AND operation_id = (p_staging->>'operationId')::uuid AND reviewer_id = p_actor AND staging = p_staging FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_STAGING_REQUIRED'; END IF;
  SELECT candidate INTO stored FROM private.composition_html_reconstruction_candidates
    WHERE organization_id = p_org AND operation_id = (p_staging->>'operationId')::uuid FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_CANDIDATE_UNAVAILABLE'; END IF;
  PERFORM private.validate_html_reconstruction_candidate(p_org,p_actor,p_staging,stored);
  RETURN stored;
END $$;
REVOKE ALL ON FUNCTION public.record_html_reconstruction_staging(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_html_reconstruction_candidate(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_html_reconstruction_staging(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_html_reconstruction_candidate(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_html_reconstruction_staging(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_html_reconstruction_candidate(uuid,uuid,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_html_reconstruction_staging(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_html_reconstruction_candidate(uuid,uuid,jsonb) TO service_role;
COMMIT;

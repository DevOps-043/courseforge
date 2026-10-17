-- PREPARED ONLY. Requires the HTML actor and snapshot archive identity readers.
-- CAP029 private review attestation only: no candidate upload/content creation.
BEGIN;
CREATE TABLE private.composition_html_reconstruction_reviews (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  candidate_id uuid NOT NULL,
  source_composition_id uuid NOT NULL REFERENCES public.video_compositions(id),
  source_draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  source_revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id),
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id),
  record jsonb NOT NULL CHECK (octet_length(record::text) <= 4096),
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,candidate_id)
);
ALTER TABLE private.composition_html_reconstruction_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_html_reconstruction_reviews FROM PUBLIC,anon,authenticated,service_role;

-- Current source/reviewer authority, NOT current template/resource authority.
-- In particular, do not compile the saved historical native/HTML document here:
-- a valid origin can be unsupported by the current compiler.
CREATE FUNCTION private.assert_html_reconstruction_review(p_org uuid,p_actor uuid,p_record jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE locator jsonb; origin jsonb; approval jsonb; archive jsonb; field text;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR jsonb_typeof(p_record) IS DISTINCT FROM 'object'
    OR octet_length(p_record::text) > 4096 THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_REVIEW_INVALID'; END IF;
  locator := p_record->'locator'; origin := p_record->'origin'; approval := p_record->'approval';
  IF jsonb_typeof(locator) IS DISTINCT FROM 'object' OR jsonb_typeof(origin) IS DISTINCT FROM 'object'
    OR jsonb_typeof(approval) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_REVIEW_INVALID'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_record)) <> 4
    OR (SELECT count(*) FROM jsonb_object_keys(locator)) <> 10
    OR (SELECT count(*) FROM jsonb_object_keys(origin)) <> 9
    OR (SELECT count(*) FROM jsonb_object_keys(approval)) <> 6
    OR p_record->>'scope' IS DISTINCT FROM 'RECONSTRUCTION_REVIEW_RECORD_NOT_CREATION_AUTHORITY'
    OR locator->>'scope' IS DISTINCT FROM 'RECONSTRUCTION_HANDOFF_LOCATOR_NOT_APPROVAL_OR_CREATION'
    OR origin->>'scope' IS DISTINCT FROM 'AUTHORIZED_RECONSTRUCTION_ORIGIN_NOT_EXECUTION_OR_APPROVAL'
    OR locator->>'organizationId' IS DISTINCT FROM p_org::text OR origin->>'organizationId' IS DISTINCT FROM p_org::text
    OR approval->>'reviewerId' IS DISTINCT FROM p_actor::text
    OR approval->>'candidateId' IS DISTINCT FROM locator->>'candidateId'
    OR approval->>'reviewedProjectHash' IS DISTINCT FROM locator->>'projectHash'
    OR approval->>'reviewedMetadataSha256' IS DISTINCT FROM locator->>'metadataSha256'
    OR approval->'completedReviews' IS DISTINCT FROM
      '["NEW_CONTENT_VISUAL_AND_ACCESSIBILITY","HISTORICAL_DERIVATION_PROVENANCE","AUTHORIZED_NEW_CONTENT_CREATION"]'::jsonb
    OR origin->>'compositionId' IS DISTINCT FROM locator->>'sourceCompositionId'
    OR origin->>'draftId' IS DISTINCT FROM locator->>'sourceDraftId'
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_REVIEW_INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(locator) e WHERE jsonb_typeof(e.value) <> 'string')
    OR EXISTS (SELECT 1 FROM jsonb_each(origin) e WHERE jsonb_typeof(e.value) <> 'string')
    OR EXISTS (SELECT 1 FROM jsonb_each(approval) e WHERE e.key <> 'completedReviews' AND jsonb_typeof(e.value) <> 'string')
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_REVIEW_INVALID'; END IF;
  FOREACH field IN ARRAY ARRAY['candidateId','sourceCompositionId','sourceDraftId','targetCompositionId','targetDocumentId','targetRevisionId'] LOOP
    IF coalesce(locator->>field,'') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_REVIEW_INVALID'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['revisionId','documentId'] LOOP
    IF coalesce(origin->>field,'') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_REVIEW_INVALID'; END IF;
  END LOOP;
  IF coalesce(locator->>'projectHash','') !~ '^[a-f0-9]{64}$' OR coalesce(locator->>'metadataSha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(approval->>'evidenceSha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(origin->>'documentHash','') !~ '^[a-f0-9]{64}$' OR coalesce(origin->>'projectHash','') !~ '^[a-f0-9]{64}$'
    OR coalesce(origin->>'bundleSha256','') !~ '^[a-f0-9]{64}$'
    OR (locator->>'targetCompositionId')::uuid = (origin->>'compositionId')::uuid
    OR (locator->>'targetDocumentId')::uuid IN ((origin->>'documentId')::uuid,(origin->>'draftId')::uuid)
    OR (locator->>'targetRevisionId')::uuid = (origin->>'revisionId')::uuid
    OR locator->>'projectHash' = origin->>'projectHash'
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_REVIEW_INVALID'; END IF;
  -- Reader locks draft, membership, composition and exact historical revision.
  archive := public.read_html_editing_snapshot_archive(p_org,p_actor,(origin->>'compositionId')::uuid,
    (origin->>'draftId')::uuid,(origin->>'revisionId')::uuid);
  IF archive->>'documentId' IS DISTINCT FROM origin->>'documentId'
    OR archive->>'documentHash' IS DISTINCT FROM origin->>'documentHash'
    OR archive->>'projectHash' IS DISTINCT FROM origin->>'projectHash'
    OR archive#>>'{bundlePin,sha256}' IS DISTINCT FROM origin->>'bundleSha256'
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_REVIEW_ORIGIN_CHANGED'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.assert_html_reconstruction_review(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.record_html_reconstruction_review(p_org uuid,p_actor uuid,p_record jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_reconstruction_reviews%ROWTYPE; inserted integer;
BEGIN
  PERFORM private.assert_html_reconstruction_review(p_org,p_actor,p_record);
  INSERT INTO private.composition_html_reconstruction_reviews(organization_id,candidate_id,source_composition_id,
    source_draft_id,source_revision_id,reviewer_id,record)
    VALUES(p_org,(p_record#>>'{locator,candidateId}')::uuid,(p_record#>>'{origin,compositionId}')::uuid,
      (p_record#>>'{origin,draftId}')::uuid,(p_record#>>'{origin,revisionId}')::uuid,p_actor,p_record)
    ON CONFLICT (organization_id,candidate_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  SELECT * INTO stored FROM private.composition_html_reconstruction_reviews
    WHERE organization_id = p_org AND candidate_id = (p_record#>>'{locator,candidateId}')::uuid FOR SHARE;
  IF stored.record IS DISTINCT FROM p_record OR stored.reviewer_id IS DISTINCT FROM p_actor
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_REVIEW_CONFLICT'; END IF;
  RETURN jsonb_build_object('record',stored.record,'created',inserted = 1,'revoked',stored.revoked);
END $$;

CREATE FUNCTION public.read_html_reconstruction_review(p_org uuid,p_actor uuid,p_record jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_reconstruction_reviews%ROWTYPE;
BEGIN
  PERFORM private.assert_html_reconstruction_review(p_org,p_actor,p_record);
  SELECT * INTO stored FROM private.composition_html_reconstruction_reviews
    WHERE organization_id = p_org AND candidate_id = (p_record#>>'{locator,candidateId}')::uuid FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  IF stored.record IS DISTINCT FROM p_record OR stored.reviewer_id IS DISTINCT FROM p_actor
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_REVIEW_CONFLICT'; END IF;
  RETURN jsonb_build_object('status','RECORDED','record',stored.record,'revoked',stored.revoked);
END $$;

CREATE FUNCTION public.revoke_html_reconstruction_review(p_org uuid,p_actor uuid,p_record jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_reconstruction_reviews%ROWTYPE;
BEGIN
  PERFORM private.assert_html_reconstruction_review(p_org,p_actor,p_record);
  SELECT * INTO stored FROM private.composition_html_reconstruction_reviews
    WHERE organization_id = p_org AND candidate_id = (p_record#>>'{locator,candidateId}')::uuid FOR UPDATE;
  IF NOT FOUND OR stored.record IS DISTINCT FROM p_record OR stored.reviewer_id IS DISTINCT FROM p_actor
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_REVIEW_CONFLICT'; END IF;
  UPDATE private.composition_html_reconstruction_reviews SET revoked = true
    WHERE organization_id = p_org AND candidate_id = stored.candidate_id;
  RETURN jsonb_build_object('status','RECORDED','record',stored.record,'revoked',true);
END $$;

REVOKE ALL ON FUNCTION public.record_html_reconstruction_review(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_html_reconstruction_review(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.revoke_html_reconstruction_review(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_html_reconstruction_review(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_html_reconstruction_review(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_html_reconstruction_review(uuid,uuid,jsonb) TO service_role;
COMMENT ON TABLE private.composition_html_reconstruction_reviews IS
  'Immutable reconstruction review identities with explicit withdrawal. Not candidate persistence, resource grants, create intent or creation receipt.';
COMMIT;

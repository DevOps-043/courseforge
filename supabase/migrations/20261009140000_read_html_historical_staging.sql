-- PREPARED ONLY. Requires 20261009130000_html_historical_publication.sql.
-- Reconcile an operator-owned locator; never upload/recompile/reapprove/retry.
BEGIN;
CREATE TABLE private.composition_html_historical_staging_locators (
  organization_id uuid NOT NULL REFERENCES public.organizations(id), candidate_id uuid NOT NULL,
  composition_id uuid NOT NULL REFERENCES public.video_compositions(id), draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id), locator jsonb NOT NULL CHECK (octet_length(locator::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (organization_id,candidate_id)
);
ALTER TABLE private.composition_html_historical_staging_locators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_html_historical_staging_locators FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.record_html_historical_staging_locator(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,p_locator jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE candidate uuid; stored private.composition_html_historical_staging_locators%ROWTYPE; inserted integer;
BEGIN
  PERFORM private.assert_html_historical_scope(p_org,p_actor,p_composition,p_draft);
  IF jsonb_typeof(p_locator) IS DISTINCT FROM 'object' OR octet_length(p_locator::text) > 4096
    OR p_locator->>'scope' IS DISTINCT FROM 'HISTORICAL_STAGING_LOCATOR_NOT_APPROVAL_OR_PUBLICATION'
    OR p_locator->>'organizationId' IS DISTINCT FROM p_org::text
    OR p_locator->>'compositionId' IS DISTINCT FROM p_composition::text OR p_locator->>'draftId' IS DISTINCT FROM p_draft::text
    OR p_locator->>'reviewerId' IS DISTINCT FROM p_actor::text OR p_locator->>'candidateId' IS NULL
    OR coalesce(p_locator->>'candidateSha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(p_locator->>'projectHash','') !~ '^[a-f0-9]{64}$'
    OR coalesce(p_locator->>'evidenceSha256','') !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'HTML_HISTORICAL_LOCATOR_INVALID'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_locator)) <> 9 THEN RAISE EXCEPTION 'HTML_HISTORICAL_LOCATOR_INVALID'; END IF;
  candidate := (p_locator->>'candidateId')::uuid;
  INSERT INTO private.composition_html_historical_staging_locators(organization_id,candidate_id,composition_id,draft_id,reviewer_id,locator)
    VALUES(p_org,candidate,p_composition,p_draft,p_actor,p_locator) ON CONFLICT (organization_id,candidate_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  SELECT * INTO stored FROM private.composition_html_historical_staging_locators WHERE organization_id = p_org AND candidate_id = candidate FOR SHARE;
  IF stored.locator IS DISTINCT FROM p_locator OR stored.reviewer_id IS DISTINCT FROM p_actor
    OR stored.composition_id IS DISTINCT FROM p_composition OR stored.draft_id IS DISTINCT FROM p_draft
    THEN RAISE EXCEPTION 'HTML_HISTORICAL_LOCATOR_CONFLICT'; END IF;
  RETURN jsonb_build_object('locator',stored.locator,'created',inserted = 1);
END $$;

-- A host adapter cannot register a candidate without the preceding durable claim.
-- Journal identity is immutable; this does not prove upload or human review.
CREATE FUNCTION private.assert_html_historical_staging_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
BEGIN
  PERFORM 1 FROM private.composition_html_historical_staging_locators
    WHERE organization_id = NEW.organization_id AND candidate_id = NEW.candidate_id
      AND composition_id = NEW.composition_id AND draft_id = NEW.draft_id AND reviewer_id = NEW.reviewer_id
      AND locator->>'candidateSha256' = NEW.payload->>'candidateSha256'
      AND locator->>'projectHash' = NEW.payload#>>'{archive,projectHash}'
      AND locator->>'evidenceSha256' = NEW.payload#>>'{approval,evidenceSha256}' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_HISTORICAL_STAGING_CLAIM_REQUIRED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER html_historical_staging_claim BEFORE INSERT ON private.composition_html_historical_candidates
  FOR EACH ROW EXECUTE FUNCTION private.assert_html_historical_staging_claim();
REVOKE ALL ON FUNCTION private.assert_html_historical_staging_claim() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_html_historical_staging(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,
  p_candidate uuid,p_candidate_sha256 text,p_project_hash text,p_evidence_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_historical_candidates%ROWTYPE; locator jsonb;
  journal private.composition_html_historical_staging_locators%ROWTYPE;
BEGIN
  IF p_candidate IS NULL OR coalesce(p_candidate_sha256,'') !~ '^[a-f0-9]{64}$'
    OR coalesce(p_project_hash,'') !~ '^[a-f0-9]{64}$'
    OR coalesce(p_evidence_sha256,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'HTML_HISTORICAL_INVALID'; END IF;
  PERFORM private.assert_html_historical_scope(p_org,p_actor,p_composition,p_draft);
  SELECT * INTO journal FROM private.composition_html_historical_staging_locators
    WHERE organization_id = p_org AND candidate_id = p_candidate FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  IF journal.composition_id IS DISTINCT FROM p_composition OR journal.draft_id IS DISTINCT FROM p_draft
    OR journal.reviewer_id IS DISTINCT FROM p_actor
    OR journal.locator->>'candidateSha256' IS DISTINCT FROM p_candidate_sha256
    OR journal.locator->>'projectHash' IS DISTINCT FROM p_project_hash
    OR journal.locator->>'evidenceSha256' IS DISTINCT FROM p_evidence_sha256
    THEN RAISE EXCEPTION 'HTML_HISTORICAL_STAGING_FORBIDDEN'; END IF;
  SELECT * INTO stored FROM private.composition_html_historical_candidates
    WHERE organization_id = p_org AND candidate_id = p_candidate FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','LOCATOR_RECORDED_STAGING_UNCONFIRMED',
    'locator',journal.locator,'scope','HISTORICAL_STAGING_METADATA_NOT_COMMIT_AUTHORITY'); END IF;
  -- Preserve revoked receipts for reconciliation, but never grant commit authority.
  IF stored.composition_id IS DISTINCT FROM p_composition OR stored.draft_id IS DISTINCT FROM p_draft
    OR stored.reviewer_id IS DISTINCT FROM p_actor
    OR stored.payload->>'candidateSha256' IS DISTINCT FROM p_candidate_sha256
    OR stored.payload#>>'{archive,projectHash}' IS DISTINCT FROM p_project_hash
    OR stored.payload#>>'{approval,evidenceSha256}' IS DISTINCT FROM p_evidence_sha256
    THEN RAISE EXCEPTION 'HTML_HISTORICAL_STAGING_FORBIDDEN'; END IF;
  locator := jsonb_build_object('scope','HISTORICAL_STAGING_LOCATOR_NOT_APPROVAL_OR_PUBLICATION',
    'organizationId',p_org,'compositionId',p_composition,'draftId',p_draft,'reviewerId',p_actor,
    'candidateId',p_candidate,'candidateSha256',p_candidate_sha256,'projectHash',p_project_hash,
    'evidenceSha256',p_evidence_sha256);
  RETURN jsonb_build_object('status','RECORDED','locator',locator,'revoked',stored.revoked,
    'scope','HISTORICAL_STAGING_METADATA_NOT_COMMIT_AUTHORITY');
END $$;
REVOKE ALL ON FUNCTION public.read_html_historical_staging(uuid,uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_historical_staging(uuid,uuid,uuid,uuid,uuid,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.record_html_historical_staging_locator(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_html_historical_staging_locator(uuid,uuid,uuid,uuid,jsonb) TO service_role;
COMMIT;

-- Durable, expiring agent proposals. Preview, apply and undo all resolve the
-- same server-authored envelope; model output is never trusted from the client.

CREATE TABLE IF NOT EXISTS public.video_composition_agent_proposals (
  id uuid PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  base_document_hash text NOT NULL CHECK (base_document_hash ~ '^[a-f0-9]{64}$'),
  envelope jsonb NOT NULL,
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPLIED', 'DISMISSED', 'EXPIRED', 'UNDONE')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  applied_version integer CHECK (applied_version > 0),
  applied_document_hash text CHECK (applied_document_hash IS NULL OR applied_document_hash ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz,
  undone_version integer CHECK (undone_version > 0),
  undone_document_hash text CHECK (undone_document_hash IS NULL OR undone_document_hash ~ '^[a-f0-9]{64}$'),
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_composition_agent_proposals_apply_state CHECK (
    (status IN ('APPLIED', 'UNDONE') AND applied_version IS NOT NULL AND applied_document_hash IS NOT NULL AND applied_at IS NOT NULL)
    OR (status NOT IN ('APPLIED', 'UNDONE') AND applied_version IS NULL AND applied_document_hash IS NULL AND applied_at IS NULL)
  ),
  CONSTRAINT video_composition_agent_proposals_undo_state CHECK (
    (status = 'UNDONE' AND undone_version IS NOT NULL AND undone_document_hash IS NOT NULL AND undone_at IS NOT NULL)
    OR (status <> 'UNDONE' AND undone_version IS NULL AND undone_document_hash IS NULL AND undone_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_video_composition_agent_proposals_draft_created
  ON public.video_composition_agent_proposals (draft_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_composition_agent_proposals_pending_expiry
  ON public.video_composition_agent_proposals (expires_at)
  WHERE status = 'PENDING';

ALTER TABLE public.video_composition_agent_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_video_composition_agent_proposals" ON public.video_composition_agent_proposals
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_agent_proposals" ON public.video_composition_agent_proposals
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_video_composition_agent_proposals" ON public.video_composition_agent_proposals
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE OR REPLACE FUNCTION public.apply_video_composition_agent_proposal(
  p_proposal_id uuid,
  p_draft_id uuid,
  p_organization_id uuid,
  p_expected_document_hash text,
  p_document jsonb,
  p_document_hash text,
  p_format text,
  p_actor_id uuid,
  p_summary text,
  p_reinforced_confirmation boolean DEFAULT false,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(outcome text, version integer, document_hash text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_proposal public.video_composition_agent_proposals%ROWTYPE;
  v_current_hash text;
  v_current_version integer;
  v_next_version integer;
BEGIN
  IF p_expected_document_hash !~ '^[a-f0-9]{64}$' OR p_document_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid document hash' USING ERRCODE = '22023';
  END IF;
  IF length(trim(p_summary)) < 3 OR length(p_summary) > 300 THEN
    RAISE EXCEPTION 'Invalid editor audit data' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_proposal
  FROM public.video_composition_agent_proposals
  WHERE id = p_proposal_id
    AND draft_id = p_draft_id
    AND organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'PROPOSAL_UNAVAILABLE'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  IF v_proposal.status = 'APPLIED' THEN
    RETURN QUERY SELECT 'ALREADY_APPLIED'::text, v_proposal.applied_version, v_proposal.applied_document_hash;
    RETURN;
  END IF;
  IF v_proposal.status = 'UNDONE' THEN
    RETURN QUERY SELECT 'ALREADY_UNDONE'::text, v_proposal.undone_version, v_proposal.undone_document_hash;
    RETURN;
  END IF;
  IF v_proposal.status <> 'PENDING' THEN
    RETURN QUERY SELECT 'PROPOSAL_UNAVAILABLE'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  IF v_proposal.expires_at <= now() THEN
    UPDATE public.video_composition_agent_proposals
    SET status = 'EXPIRED', updated_at = now()
    WHERE id = p_proposal_id;
    RETURN QUERY SELECT 'PROPOSAL_EXPIRED'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  IF coalesce((v_proposal.envelope #>> '{risk,requiresReinforcedConfirmation}')::boolean, false)
    AND NOT p_reinforced_confirmation THEN
    RETURN QUERY SELECT 'CONFIRMATION_REQUIRED'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  IF v_proposal.base_document_hash <> p_expected_document_hash THEN
    RETURN QUERY SELECT 'CONFLICT'::text, NULL::integer, v_proposal.base_document_hash;
    RETURN;
  END IF;

  BEGIN
    PERFORM 1 FROM public.video_composition_drafts
    WHERE id = p_draft_id AND organization_id = p_organization_id AND state = 'ACTIVE'
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN QUERY SELECT 'BUSY'::text, NULL::integer, NULL::text;
    RETURN;
  END;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_EDITABLE'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  SELECT d.document_hash, d.version INTO v_current_hash, v_current_version
  FROM public.video_composition_draft_documents AS d
  WHERE d.draft_id = p_draft_id AND d.organization_id = p_organization_id
  ORDER BY d.version DESC LIMIT 1;
  IF NOT FOUND OR v_current_hash <> p_expected_document_hash THEN
    RETURN QUERY SELECT 'CONFLICT'::text, v_current_version, v_current_hash;
    RETURN;
  END IF;

  v_next_version := v_current_version + 1;
  INSERT INTO public.video_composition_draft_documents (
    draft_id, organization_id, version, format, document, document_hash, created_by
  ) VALUES (
    p_draft_id, p_organization_id, v_next_version, p_format, p_document, p_document_hash, p_actor_id
  );
  INSERT INTO public.video_composition_draft_changes (
    draft_id, organization_id, version, actor_id, source, summary, metadata
  ) VALUES (
    p_draft_id, p_organization_id, v_next_version, p_actor_id, 'AGENT', trim(p_summary),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('proposalId', p_proposal_id)
  );
  UPDATE public.video_composition_drafts
  SET current_version = v_next_version, last_changed_by = p_actor_id, updated_at = now()
  WHERE id = p_draft_id AND organization_id = p_organization_id;
  UPDATE public.video_composition_agent_proposals
  SET status = 'APPLIED', applied_version = v_next_version,
      applied_document_hash = p_document_hash, applied_at = now(), updated_at = now()
  WHERE id = p_proposal_id;

  RETURN QUERY SELECT 'APPLIED'::text, v_next_version, p_document_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_video_composition_agent_proposal(
  p_proposal_id uuid,
  p_draft_id uuid,
  p_organization_id uuid,
  p_expected_document_hash text,
  p_document jsonb,
  p_document_hash text,
  p_format text,
  p_actor_id uuid,
  p_summary text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(outcome text, version integer, document_hash text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_proposal public.video_composition_agent_proposals%ROWTYPE;
  v_current_hash text;
  v_current_version integer;
  v_next_version integer;
BEGIN
  IF p_expected_document_hash !~ '^[a-f0-9]{64}$' OR p_document_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid document hash' USING ERRCODE = '22023';
  END IF;
  IF length(trim(p_summary)) < 3 OR length(p_summary) > 300 THEN
    RAISE EXCEPTION 'Invalid editor audit data' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_proposal
  FROM public.video_composition_agent_proposals
  WHERE id = p_proposal_id AND draft_id = p_draft_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'PROPOSAL_UNAVAILABLE'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  IF v_proposal.status = 'UNDONE' THEN
    RETURN QUERY SELECT 'ALREADY_UNDONE'::text, v_proposal.undone_version, v_proposal.undone_document_hash;
    RETURN;
  END IF;
  IF v_proposal.status <> 'APPLIED' OR v_proposal.applied_document_hash <> p_expected_document_hash THEN
    RETURN QUERY SELECT 'UNDO_CONFLICT'::text, v_proposal.applied_version, v_proposal.applied_document_hash;
    RETURN;
  END IF;
  IF p_document_hash <> v_proposal.base_document_hash THEN
    RETURN QUERY SELECT 'UNDO_CONFLICT'::text, v_proposal.applied_version, v_proposal.applied_document_hash;
    RETURN;
  END IF;

  BEGIN
    PERFORM 1 FROM public.video_composition_drafts
    WHERE id = p_draft_id AND organization_id = p_organization_id AND state = 'ACTIVE'
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN QUERY SELECT 'BUSY'::text, NULL::integer, NULL::text;
    RETURN;
  END;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_EDITABLE'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  SELECT d.document_hash, d.version INTO v_current_hash, v_current_version
  FROM public.video_composition_draft_documents AS d
  WHERE d.draft_id = p_draft_id AND d.organization_id = p_organization_id
  ORDER BY d.version DESC LIMIT 1;
  IF NOT FOUND OR v_current_hash <> p_expected_document_hash THEN
    RETURN QUERY SELECT 'UNDO_CONFLICT'::text, v_current_version, v_current_hash;
    RETURN;
  END IF;

  v_next_version := v_current_version + 1;
  INSERT INTO public.video_composition_draft_documents (
    draft_id, organization_id, version, format, document, document_hash, created_by
  ) VALUES (
    p_draft_id, p_organization_id, v_next_version, p_format, p_document, p_document_hash, p_actor_id
  );
  INSERT INTO public.video_composition_draft_changes (
    draft_id, organization_id, version, actor_id, source, summary, metadata
  ) VALUES (
    p_draft_id, p_organization_id, v_next_version, p_actor_id, 'USER', trim(p_summary),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('proposalId', p_proposal_id, 'undo', true)
  );
  UPDATE public.video_composition_drafts
  SET current_version = v_next_version, last_changed_by = p_actor_id, updated_at = now()
  WHERE id = p_draft_id AND organization_id = p_organization_id;
  UPDATE public.video_composition_agent_proposals
  SET status = 'UNDONE', undone_version = v_next_version,
      undone_document_hash = p_document_hash, undone_at = now(), updated_at = now()
  WHERE id = p_proposal_id;

  RETURN QUERY SELECT 'UNDONE'::text, v_next_version, p_document_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_video_composition_agent_proposal(uuid, uuid, uuid, text, jsonb, text, text, uuid, text, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_video_composition_agent_proposal(uuid, uuid, uuid, text, jsonb, text, text, uuid, text, boolean, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.undo_video_composition_agent_proposal(uuid, uuid, uuid, text, jsonb, text, text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_video_composition_agent_proposal(uuid, uuid, uuid, text, jsonb, text, text, uuid, text, jsonb) TO service_role;

-- Fixes the append RPC used by the native editor. The output column
-- `document_hash` shadowed the table column of the same name, causing every
-- save attempt to abort with PostgreSQL error 42702 before a version was made.

CREATE OR REPLACE FUNCTION public.append_video_composition_draft_document(
  p_draft_id uuid,
  p_organization_id uuid,
  p_expected_document_hash text,
  p_document jsonb,
  p_document_hash text,
  p_format text,
  p_actor_id uuid,
  p_source text,
  p_summary text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(version integer, document_hash text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current_hash text;
  v_current_version integer;
  v_next_version integer;
BEGIN
  IF p_expected_document_hash !~ '^[a-f0-9]{64}$' OR p_document_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid document hash' USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('USER', 'AGENT', 'SYSTEM') OR length(trim(p_summary)) < 3 OR length(p_summary) > 300 THEN
    RAISE EXCEPTION 'Invalid editor audit data' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.video_composition_drafts
  WHERE id = p_draft_id AND organization_id = p_organization_id AND state = 'ACTIVE'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found or is not editable' USING ERRCODE = 'P0002'; END IF;

  SELECT d.document_hash, d.version
  INTO v_current_hash, v_current_version
  FROM public.video_composition_draft_documents AS d
  WHERE d.draft_id = p_draft_id AND d.organization_id = p_organization_id
  ORDER BY d.version DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft document not found' USING ERRCODE = 'P0002'; END IF;
  IF v_current_hash <> p_expected_document_hash THEN RAISE EXCEPTION 'Document version conflict' USING ERRCODE = '40001'; END IF;

  v_next_version := v_current_version + 1;
  INSERT INTO public.video_composition_draft_documents (draft_id, organization_id, version, format, document, document_hash, created_by)
  VALUES (p_draft_id, p_organization_id, v_next_version, p_format, p_document, p_document_hash, p_actor_id);
  INSERT INTO public.video_composition_draft_changes (draft_id, organization_id, version, actor_id, source, summary, metadata)
  VALUES (p_draft_id, p_organization_id, v_next_version, p_actor_id, p_source, trim(p_summary), coalesce(p_metadata, '{}'::jsonb));
  UPDATE public.video_composition_drafts
  SET current_version = v_next_version, last_changed_by = p_actor_id, updated_at = now()
  WHERE id = p_draft_id AND organization_id = p_organization_id;

  RETURN QUERY SELECT v_next_version, p_document_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.append_video_composition_draft_document(uuid, uuid, text, jsonb, text, text, uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_video_composition_draft_document(uuid, uuid, text, jsonb, text, text, uuid, text, text, jsonb) TO service_role;

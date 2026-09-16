-- Restores an immutable render snapshot back into the editable timeline.
-- The active render revision, append-only editor document and branding links
-- move together under one transaction and one optimistic concurrency guard.

CREATE OR REPLACE FUNCTION public.restore_video_composition_snapshot_to_editor(
  p_revision_id uuid,
  p_composition_id uuid,
  p_draft_id uuid,
  p_organization_id uuid,
  p_expected_document_hash text,
  p_actor_id uuid
)
RETURNS TABLE(outcome text, version integer, document_hash text, document jsonb)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_active_revision_id uuid;
  v_current_document jsonb;
  v_current_hash text;
  v_current_version integer;
  v_draft_state text;
  v_intro_asset_id uuid;
  v_manifest jsonb;
  v_next_version integer;
  v_outro_asset_id uuid;
  v_target_document jsonb;
  v_target_format text;
  v_target_hash text;
  v_target_version integer;
BEGIN
  IF p_expected_document_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid document hash' USING ERRCODE = '22023';
  END IF;

  SELECT c.active_revision_id
  INTO v_active_revision_id
  FROM public.video_compositions c
  WHERE c.id = p_composition_id AND c.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::integer, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  BEGIN
    SELECT d.state
    INTO v_draft_state
    FROM public.video_composition_drafts d
    WHERE d.id = p_draft_id
      AND d.composition_id = p_composition_id
      AND d.organization_id = p_organization_id
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN QUERY SELECT 'BUSY'::text, NULL::integer, NULL::text, NULL::jsonb;
    RETURN;
  END;
  IF NOT FOUND OR v_draft_state <> 'ACTIVE' THEN
    RETURN QUERY SELECT 'NOT_EDITABLE'::text, NULL::integer, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  SELECT r.manifest
  INTO v_manifest
  FROM public.video_composition_revisions r
  WHERE r.id = p_revision_id
    AND r.composition_id = p_composition_id
    AND r.organization_id = p_organization_id
    AND r.manifest @> '{"snapshot": true}'::jsonb;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::integer, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  v_target_hash := v_manifest ->> 'draft_document_hash';
  BEGIN
    v_target_version := (v_manifest ->> 'draft_document_version')::integer;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN QUERY SELECT 'INVALID_SNAPSHOT'::text, NULL::integer, NULL::text, NULL::jsonb;
    RETURN;
  END;
  IF v_target_hash IS NULL OR v_target_hash !~ '^[a-f0-9]{64}$' OR v_target_version IS NULL OR v_target_version < 1 THEN
    RETURN QUERY SELECT 'INVALID_SNAPSHOT'::text, NULL::integer, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  SELECT dd.document, dd.format
  INTO v_target_document, v_target_format
  FROM public.video_composition_draft_documents dd
  WHERE dd.draft_id = p_draft_id
    AND dd.organization_id = p_organization_id
    AND dd.version = v_target_version
    AND dd.document_hash = v_target_hash;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'SOURCE_NOT_FOUND'::text, NULL::integer, v_target_hash, NULL::jsonb;
    RETURN;
  END IF;

  SELECT dd.document, dd.document_hash, dd.version
  INTO v_current_document, v_current_hash, v_current_version
  FROM public.video_composition_draft_documents dd
  WHERE dd.draft_id = p_draft_id AND dd.organization_id = p_organization_id
  ORDER BY dd.version DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'SOURCE_NOT_FOUND'::text, NULL::integer, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  IF v_current_hash = v_target_hash AND v_active_revision_id = p_revision_id THEN
    RETURN QUERY SELECT 'ALREADY_RESTORED'::text, v_current_version, v_current_hash, v_current_document;
    RETURN;
  END IF;
  IF v_current_hash <> p_expected_document_hash THEN
    RETURN QUERY SELECT 'CONFLICT'::text, v_current_version, v_current_hash, v_current_document;
    RETURN;
  END IF;

  SELECT
    max(CASE WHEN clip -> 'source' ->> 'placement' = 'INTRO'
      THEN clip -> 'source' ->> 'assemblyBrandAssetId' END)::uuid,
    max(CASE WHEN clip -> 'source' ->> 'placement' = 'OUTRO'
      THEN clip -> 'source' ->> 'assemblyBrandAssetId' END)::uuid
  INTO v_intro_asset_id, v_outro_asset_id
  FROM jsonb_array_elements(coalesce(v_target_document -> 'clips', '[]'::jsonb)) AS clips(clip)
  WHERE clip -> 'source' ->> 'type' = 'ASSEMBLY_BRAND_ASSET';

  IF v_intro_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organization_assembly_assets a
    WHERE a.id = v_intro_asset_id AND a.organization_id = p_organization_id
      AND a.kind = 'INTRO' AND a.status IN ('APPROVED', 'ARCHIVED')
  ) THEN
    RETURN QUERY SELECT 'SOURCE_ASSET_UNAVAILABLE'::text, NULL::integer, v_target_hash, NULL::jsonb;
    RETURN;
  END IF;
  IF v_outro_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organization_assembly_assets a
    WHERE a.id = v_outro_asset_id AND a.organization_id = p_organization_id
      AND a.kind = 'OUTRO' AND a.status IN ('APPROVED', 'ARCHIVED')
  ) THEN
    RETURN QUERY SELECT 'SOURCE_ASSET_UNAVAILABLE'::text, NULL::integer, v_target_hash, NULL::jsonb;
    RETURN;
  END IF;

  INSERT INTO public.video_composition_draft_branding (
    draft_id, organization_id, intro_asset_id, outro_asset_id, intro_source,
    intro_snapshot, outro_snapshot, resolved_at, resolved_by, updated_at
  ) VALUES (
    p_draft_id, p_organization_id, v_intro_asset_id, v_outro_asset_id, 'ASSEMBLY_OVERRIDE',
    NULL, NULL, now(), p_actor_id, now()
  )
  ON CONFLICT (draft_id) DO UPDATE SET
    intro_asset_id = EXCLUDED.intro_asset_id,
    outro_asset_id = EXCLUDED.outro_asset_id,
    intro_source = EXCLUDED.intro_source,
    intro_snapshot = EXCLUDED.intro_snapshot,
    outro_snapshot = EXCLUDED.outro_snapshot,
    resolved_at = EXCLUDED.resolved_at,
    resolved_by = EXCLUDED.resolved_by,
    updated_at = EXCLUDED.updated_at
  WHERE public.video_composition_draft_branding.organization_id = p_organization_id;

  IF v_current_hash = v_target_hash THEN
    UPDATE public.video_compositions
    SET active_revision_id = p_revision_id, status = 'READY_FOR_PREVIEW', updated_at = now()
    WHERE id = p_composition_id AND organization_id = p_organization_id;
    RETURN QUERY SELECT 'ACTIVATED'::text, v_current_version, v_current_hash, v_current_document;
    RETURN;
  END IF;

  v_next_version := v_current_version + 1;
  INSERT INTO public.video_composition_draft_documents (
    draft_id, organization_id, version, format, document, document_hash, created_by
  ) VALUES (
    p_draft_id, p_organization_id, v_next_version, v_target_format,
    v_target_document, v_target_hash, p_actor_id
  );
  INSERT INTO public.video_composition_draft_changes (
    draft_id, organization_id, version, actor_id, source, summary, metadata
  ) VALUES (
    p_draft_id, p_organization_id, v_next_version, p_actor_id, 'USER',
    'Restauró un snapshot en el timeline.',
    jsonb_build_object(
      'restoredSnapshotRevisionId', p_revision_id,
      'restoredDocumentHash', v_target_hash,
      'restoredDocumentVersion', v_target_version
    )
  );
  UPDATE public.video_composition_drafts
  SET current_version = v_next_version, last_changed_by = p_actor_id, updated_at = now()
  WHERE id = p_draft_id AND organization_id = p_organization_id;
  UPDATE public.video_compositions
  SET active_revision_id = p_revision_id, status = 'READY_FOR_PREVIEW', updated_at = now()
  WHERE id = p_composition_id AND organization_id = p_organization_id;

  RETURN QUERY SELECT 'RESTORED'::text, v_next_version, v_target_hash, v_target_document;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_video_composition_snapshot_to_editor(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_video_composition_snapshot_to_editor(uuid, uuid, uuid, uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public.restore_video_composition_snapshot_to_editor(uuid, uuid, uuid, uuid, text, uuid) IS
  'Atomically reactivates an immutable snapshot and appends its source editor document so preview and timeline show the restored state.';

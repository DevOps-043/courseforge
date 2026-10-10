-- PREPARED ONLY. CAP029 historical metadata inventory. Do not apply or enable routes.
-- Depends on HTML actor assertion and composition/draft/revision tables.
-- Uses existing UNIQUE(composition_id,revision_number) index for keyset pages.
BEGIN;
CREATE FUNCTION public.read_html_editing_snapshot_history(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,
  p_ceiling_revision integer DEFAULT NULL,p_after_revision integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE ceiling_revision integer; last_revision integer; scanned integer := 0;
  revision_row record; entries jsonb := '[]'::jsonb; next_cursor jsonb := NULL;
  pin jsonb; draft_identity text; document_hash text; is_snapshot boolean; pin_valid boolean;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_composition IS NULL OR p_draft IS NULL
    OR p_after_revision IS NULL OR p_after_revision < 0
    OR (p_ceiling_revision IS NOT NULL AND (p_ceiling_revision < 0 OR p_after_revision > p_ceiling_revision))
    OR (p_ceiling_revision IS NULL AND p_after_revision <> 0) THEN RAISE EXCEPTION 'HTML_SNAPSHOT_HISTORY_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft AND organization_id = p_org
    AND composition_id = p_composition AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_HISTORY_FORBIDDEN'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  PERFORM 1 FROM public.video_compositions WHERE id = p_composition AND organization_id = p_org
    AND status <> 'ARCHIVED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_HISTORY_FORBIDDEN'; END IF;
  -- Upper watermark excludes later publications, not a multi-request DB snapshot.
  -- Immutable revision identity/order is required; if history is edited, restart.
  SELECT COALESCE(max(revision_number),0) INTO ceiling_revision FROM public.video_composition_revisions
    WHERE composition_id = p_composition AND organization_id = p_org;
  IF p_ceiling_revision IS NOT NULL THEN
    IF p_ceiling_revision > ceiling_revision THEN RAISE EXCEPTION 'HTML_SNAPSHOT_HISTORY_INVALID'; END IF;
    ceiling_revision := p_ceiling_revision;
  END IF;
  FOR revision_row IN SELECT id,revision_number,
      manifest->'snapshot' AS snapshot_flag,manifest->>'draft_document_id' AS draft_identity,
      manifest->>'draft_document_hash' AS document_hash,manifest->'html_editing_snapshot' AS bundle_pin
    FROM public.video_composition_revisions WHERE organization_id = p_org AND composition_id = p_composition
      AND revision_number > p_after_revision AND revision_number <= ceiling_revision
    ORDER BY revision_number ASC LIMIT 21
  LOOP
    scanned := scanned + 1;
    IF scanned > 20 THEN
      next_cursor := jsonb_build_object('actorId',p_actor,'organizationId',p_org,'compositionId',p_composition,'draftId',p_draft,
        'ceilingRevision',ceiling_revision,'afterRevision',last_revision);
      EXIT;
    END IF;
    last_revision := revision_row.revision_number;
    is_snapshot := COALESCE(revision_row.snapshot_flag = 'true'::jsonb,false);
    draft_identity := CASE WHEN revision_row.draft_identity ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      THEN revision_row.draft_identity ELSE NULL END;
    document_hash := CASE WHEN revision_row.document_hash ~ '^[a-f0-9]{64}$' THEN revision_row.document_hash ELSE NULL END;
    pin := revision_row.bundle_pin;
    pin_valid := false;
    IF jsonb_typeof(pin) = 'object' THEN
      pin_valid := pin->'schemaVersion' = '1'::jsonb AND pin->>'path' = 'html-editing-revisions.json'
        AND pin->>'sha256' ~ '^[a-f0-9]{64}$' AND (SELECT count(*) FROM jsonb_object_keys(pin)) = 3;
    END IF;
    entries := entries || jsonb_build_array(jsonb_build_object('revisionId',revision_row.id,'revisionNumber',last_revision,
      'snapshot',is_snapshot,'draftId',draft_identity,'documentHash',document_hash,'bundlePin',CASE WHEN pin_valid THEN pin ELSE NULL END,
      'metadataStatus',CASE WHEN NOT is_snapshot THEN 'NOT_MARKED_AS_SNAPSHOT'
        WHEN pin_valid AND draft_identity IS NOT NULL AND document_hash IS NOT NULL THEN 'HTML_PIN_REQUIRES_BYTE_INSPECTION'
        ELSE 'MISSING_OR_INVALID_HTML_METADATA' END));
  END LOOP;
  RETURN jsonb_build_object('scope','AUTHORIZED_HISTORY_METADATA_NOT_CONTENT_OR_EXECUTION_AUTHORITY',
    'actorId',p_actor,'organizationId',p_org,'compositionId',p_composition,'draftId',p_draft,
    'ceilingRevision',ceiling_revision,'entries',entries,'nextCursor',next_cursor);
END $$;
REVOKE ALL ON FUNCTION public.read_html_editing_snapshot_history(uuid,uuid,uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_editing_snapshot_history(uuid,uuid,uuid,uuid,integer,integer) TO service_role;
COMMENT ON FUNCTION public.read_html_editing_snapshot_history(uuid,uuid,uuid,uuid,integer,integer) IS
  'Authorized bounded metadata inventory only. Includes unmarked/malformed legacy rows; never compiles, signs, downloads, restores or attests compatibility.';
COMMIT;

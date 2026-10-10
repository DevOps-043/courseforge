-- PREPARED ONLY. CAP029 read-only historical archive identity. Do not apply/enable.
BEGIN;
CREATE FUNCTION public.read_html_editing_snapshot_archive(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,p_revision uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE revision_row record; document_id uuid; document_hash text; pin jsonb;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_composition IS NULL OR p_draft IS NULL OR p_revision IS NULL
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_ARCHIVE_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft AND organization_id = p_org
    AND composition_id = p_composition AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_ARCHIVE_FORBIDDEN'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  PERFORM 1 FROM public.video_compositions WHERE id = p_composition AND organization_id = p_org
    AND status <> 'ARCHIVED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_ARCHIVE_FORBIDDEN'; END IF;
  SELECT id,project_hash,project_archive_size_bytes,project_storage_bucket,project_storage_path,
    manifest->'snapshot' AS snapshot_flag,manifest->>'draft_document_id' AS document_id,
    manifest->>'draft_document_hash' AS document_hash,manifest->'html_editing_snapshot' AS bundle_pin
  INTO revision_row FROM public.video_composition_revisions
    WHERE id = p_revision AND organization_id = p_org AND composition_id = p_composition FOR SHARE;
  IF NOT FOUND OR revision_row.snapshot_flag IS DISTINCT FROM 'true'::jsonb
    OR revision_row.document_id IS NULL
    OR revision_row.document_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    OR revision_row.document_hash IS NULL OR revision_row.document_hash !~ '^[a-f0-9]{64}$'
    OR revision_row.project_hash IS NULL OR revision_row.project_hash !~ '^[a-f0-9]{64}$'
    OR revision_row.project_archive_size_bytes IS NULL OR revision_row.project_archive_size_bytes NOT BETWEEN 1 AND 209715200
    OR revision_row.project_storage_bucket IS DISTINCT FROM 'production-assets'
    OR revision_row.project_storage_path IS DISTINCT FROM
      ('composition-snapshots/'||p_org::text||'/'||p_composition::text||'/'||revision_row.project_hash||'.zip')
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_ARCHIVE_UNAVAILABLE'; END IF;
  document_id := revision_row.document_id::uuid; document_hash := revision_row.document_hash; pin := revision_row.bundle_pin;
  -- A claimed document ID is not sufficient: it must belong to this composition/tenant.
  -- Historical drafts may be inactive; the current request draft must be ACTIVE.
  PERFORM 1 FROM public.video_composition_drafts WHERE id = document_id AND organization_id = p_org
    AND composition_id = p_composition FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_ARCHIVE_FORBIDDEN'; END IF;
  IF jsonb_typeof(pin) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'HTML_SNAPSHOT_ARCHIVE_UNAVAILABLE'; END IF;
  IF pin->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR pin->>'path' IS DISTINCT FROM 'html-editing-revisions.json'
    OR pin->>'sha256' IS NULL OR pin->>'sha256' !~ '^[a-f0-9]{64}$'
    OR (SELECT count(*) FROM jsonb_object_keys(pin)) <> 3
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_ARCHIVE_UNAVAILABLE'; END IF;
  RETURN jsonb_build_object('scope','AUTHORIZED_HISTORICAL_HTML_ARCHIVE_READ_ONLY',
    'actorId',p_actor,'organizationId',p_org,'compositionId',p_composition,'draftId',p_draft,'revisionId',p_revision,
    'documentId',document_id,'documentHash',document_hash,'projectHash',revision_row.project_hash,
    'archiveBytes',revision_row.project_archive_size_bytes,'storageBucket',revision_row.project_storage_bucket,
    'storagePath',revision_row.project_storage_path,'bundlePin',pin);
END $$;
REVOKE ALL ON FUNCTION public.read_html_editing_snapshot_archive(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_editing_snapshot_archive(uuid,uuid,uuid,uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.read_html_editing_snapshot_archive(uuid,uuid,uuid,uuid,uuid) IS
  'Read-only exact historical snapshot identity after current actor/draft/composition authorization. No compiler, publication or execution authority.';
COMMIT;

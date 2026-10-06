-- PREPARED ONLY. Read-only reconciliation; not a retry or activation endpoint.
BEGIN;
CREATE FUNCTION public.read_html_editing_snapshot_operation(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,
  p_operation uuid,p_document_hash text,p_project_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE composition public.video_compositions%ROWTYPE; operation private.composition_html_snapshot_operations%ROWTYPE;
  manifest jsonb; archive jsonb; exact_read jsonb; grants jsonb; result jsonb;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_composition IS NULL OR p_draft IS NULL OR p_operation IS NULL
    OR p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$'
    OR p_project_hash IS NULL OR p_project_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'HTML_SNAPSHOT_READ_INVALID'; END IF;
  -- Same root order as publication. A pending commit holding this root must
  -- settle before this read observes an absent operation; no dirty-read claim.
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft AND organization_id = p_org
    AND composition_id = p_composition AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_DRAFT_FORBIDDEN'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  SELECT * INTO composition FROM public.video_compositions WHERE id = p_composition AND organization_id = p_org
    AND status <> 'ARCHIVED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_COMPOSITION_FORBIDDEN'; END IF;
  SELECT * INTO operation FROM private.composition_html_snapshot_operations WHERE organization_id = p_org AND operation_id = p_operation FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  IF operation.actor_id IS DISTINCT FROM p_actor OR operation.composition_id IS DISTINCT FROM p_composition
    OR operation.draft_id IS DISTINCT FROM p_draft OR operation.request->>'actor' IS DISTINCT FROM p_actor::text
    OR operation.request->>'composition' IS DISTINCT FROM p_composition::text OR operation.request->>'draft' IS DISTINCT FROM p_draft::text
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_OPERATION_FORBIDDEN'; END IF;
  archive := operation.request#>'{payload,archive}'; manifest := operation.request#>'{payload,manifest}';
  IF manifest->>'draft_document_hash' IS DISTINCT FROM p_document_hash OR manifest->>'draft_document_id' IS DISTINCT FROM p_draft::text
    OR archive->>'projectHash' IS DISTINCT FROM p_project_hash THEN RAISE EXCEPTION 'HTML_SNAPSHOT_OPERATION_CONFLICT'; END IF;
  -- Exact historical read and current grants, never today's latest HTML state.
  exact_read := public.read_html_editing_compilation(p_org,p_draft,p_actor,p_document_hash);
  SELECT coalesce(jsonb_agg(DISTINCT id),'[]'::jsonb) INTO grants FROM
    jsonb_array_elements(exact_read->'revisions') r, jsonb_array_elements_text(r->'grantedAssetIds') g(id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(operation.request#>'{payload,htmlUsedAssetIds}') u(id) WHERE NOT (grants ? u.id))
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_HTML_GRANT_REVOKED'; END IF;
  PERFORM private.html_snapshot_resource_bindings(p_org,p_draft,manifest->'asset_manifest',manifest->'font_manifest');
  PERFORM 1 FROM public.video_composition_revisions v WHERE v.id = operation.revision_id AND v.organization_id = p_org
    AND v.composition_id = p_composition AND v.manifest = manifest AND v.project_hash = p_project_hash
    AND v.project_storage_bucket = archive->>'storageBucket' AND v.project_storage_path = archive->>'storagePath'
    AND v.project_archive_size_bytes = (archive->>'sizeBytes')::bigint FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_REUSE_CONFLICT'; END IF;
  -- ACK remains the original commit observation. Current active can be NULL or
  -- a different revision; neither condition is permission to reactivate it.
  result := jsonb_build_object('status','COMMITTED','acknowledgment',operation.acknowledgment,
    'currentActiveRevisionId',composition.active_revision_id);
  IF octet_length(result::text) > 4096 THEN RAISE EXCEPTION 'HTML_SNAPSHOT_READ_INVALID'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_html_editing_snapshot_operation(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_editing_snapshot_operation(uuid,uuid,uuid,uuid,uuid,text,text) TO service_role;
COMMENT ON FUNCTION public.read_html_editing_snapshot_operation(uuid,uuid,uuid,uuid,uuid,text,text) IS
  'Prepared owner-scoped current-authority reconciliation of registration only; no mutation, archive-byte attestation, automatic retry or activation.';
COMMIT;

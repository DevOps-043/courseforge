-- Scoped worker read. No authenticated user access or conformance approval.
CREATE FUNCTION public.read_hyperframes_visual_conformance_evidence(
  p_organization_id uuid, p_revision_id uuid, p_bundle_sha256 text
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, private AS $$
  SELECT jsonb_build_object(
    'organizationId', e.organization_id, 'revisionId', e.revision_id,
    'checksum', e.bundle_sha256, 'projectHash', e.project_hash,
    'documentHash', e.document_hash, 'storagePath', e.storage_path,
    'sizeBytes', e.file_size_bytes, 'frames', e.frames, 'status', e.status,
    'contract', r.manifest->'conformance_contract'
  )
  FROM private.hyperframes_visual_conformance_evidence e
  JOIN public.video_composition_revisions r
    ON r.id = e.revision_id AND r.organization_id = e.organization_id
  WHERE e.organization_id = p_organization_id AND e.revision_id = p_revision_id
    AND e.bundle_sha256 = p_bundle_sha256
    AND r.project_hash = e.project_hash
    AND r.manifest->>'conformance_reference_version' = '1'
    AND r.manifest->>'draft_document_hash' = e.document_hash
    AND r.manifest->'conformance_contract'->>'documentHash' = e.document_hash;
$$;
REVOKE ALL ON FUNCTION public.read_hyperframes_visual_conformance_evidence(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_hyperframes_visual_conformance_evidence(uuid, uuid, text) TO service_role;

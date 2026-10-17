-- Prepared only. Coordinated reader/worker deployment is required before enabling long audio.
-- Keeps v1 bounds; v2 is source-derived chunked PCM, not browser playback or QA approval.
ALTER TABLE private.hyperframes_audio_conformance_evidence
  DROP CONSTRAINT hyperframes_audio_conformance_evidence_file_size_bytes_check;
ALTER TABLE private.hyperframes_audio_conformance_evidence
  ADD CONSTRAINT hyperframes_audio_conformance_evidence_file_size_bytes_check
  CHECK (file_size_bytes > 0 AND file_size_bytes <= 50331648);

CREATE OR REPLACE FUNCTION public.record_hyperframes_audio_conformance_evidence(
  p_organization_id uuid, p_revision_id uuid, p_visual_checksum text,
  p_bundle_sha256 text, p_file_size_bytes bigint, p_receipt jsonb
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE v_revision public.video_composition_revisions%ROWTYPE;
  v_visual private.hyperframes_visual_conformance_evidence%ROWTYPE; v_path text; v_duration_limit integer;
BEGIN
  IF p_bundle_sha256 IS NULL OR p_bundle_sha256 !~ '^[a-f0-9]{64}$'
    OR p_visual_checksum IS NULL OR p_visual_checksum !~ '^[a-f0-9]{64}$'
    OR p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 OR p_file_size_bytes > 50331648
    OR p_receipt IS NULL OR jsonb_typeof(p_receipt) <> 'object' OR octet_length(p_receipt::text) > 65536 THEN
    RAISE EXCEPTION 'invalid audio evidence';
  END IF;
  IF p_receipt->>'schemaVersion' = '1' AND p_receipt->>'method' = 'PREVIEW_RULES_STEREO_PCM_V1'
    AND p_file_size_bytes <= 8388608 AND NOT (p_receipt ? 'mixChunkFrames') THEN
    v_duration_limit := 120;
  ELSIF p_receipt->>'schemaVersion' = '2' AND p_receipt->>'method' = 'PREVIEW_RULES_STEREO_PCM_CHUNKED_V2'
    AND p_receipt->>'mixChunkFrames' = '80000' THEN
    v_duration_limit := 600;
  ELSE RAISE EXCEPTION 'invalid audio evidence version'; END IF;
  SELECT * INTO v_revision FROM public.video_composition_revisions
    WHERE id = p_revision_id AND organization_id = p_organization_id FOR SHARE;
  SELECT * INTO v_visual FROM private.hyperframes_visual_conformance_evidence
    WHERE revision_id = p_revision_id AND bundle_sha256 = p_visual_checksum AND organization_id = p_organization_id FOR SHARE;
  IF v_revision.id IS NULL OR v_visual.revision_id IS NULL
    OR v_revision.project_hash IS DISTINCT FROM v_visual.project_hash
    OR v_revision.manifest->>'conformance_reference_version' IS DISTINCT FROM '1'
    OR v_revision.manifest->>'draft_document_hash' IS DISTINCT FROM v_visual.document_hash
    OR v_revision.manifest->'conformance_contract'->>'documentHash' IS DISTINCT FROM v_visual.document_hash
    OR p_receipt->>'organizationId' IS DISTINCT FROM p_organization_id::text
    OR p_receipt->>'revisionId' IS DISTINCT FROM p_revision_id::text
    OR p_receipt->>'visualChecksum' IS DISTINCT FROM p_visual_checksum
    OR p_receipt->>'projectHash' IS DISTINCT FROM v_visual.project_hash
    OR p_receipt->>'documentHash' IS DISTINCT FROM v_visual.document_hash
    OR p_receipt->>'status' IS DISTINCT FROM 'SOURCE_MIX_REFERENCE_NOT_PLAYBACK_CAPTURE'
    OR p_receipt->>'audioEnvelopeVersion' IS DISTINCT FROM '2'
    OR p_receipt->>'sampleRate' IS DISTINCT FROM '8000'
    OR p_receipt->>'channels' IS DISTINCT FROM '2'
    OR coalesce(p_receipt->>'audioSha256', '') !~ '^[a-f0-9]{64}$'
    OR NOT (p_receipt ?& ARRAY['durationSeconds','peak','clipCount','decodedAssetCount','assetCount','mediaBytes']) THEN
    RAISE EXCEPTION 'audio evidence revision mismatch';
  END IF;
  IF (p_receipt->>'durationSeconds')::numeric IS DISTINCT FROM (v_revision.manifest->'conformance_contract'->'canvas'->>'durationSeconds')::numeric
    OR NOT coalesce((p_receipt->>'durationSeconds')::numeric > 0 AND (p_receipt->>'durationSeconds')::numeric <= v_duration_limit, false)
    OR NOT coalesce((p_receipt->>'peak')::numeric BETWEEN 0 AND 1, false)
    OR NOT coalesce((p_receipt->>'clipCount')::integer BETWEEN 0 AND 64, false)
    OR NOT coalesce((p_receipt->>'decodedAssetCount')::integer BETWEEN 0 AND (p_receipt->>'clipCount')::integer, false)
    OR NOT coalesce((p_receipt->>'assetCount')::integer BETWEEN (p_receipt->>'decodedAssetCount')::integer AND 250, false)
    OR NOT coalesce((p_receipt->>'mediaBytes')::bigint BETWEEN 0 AND 2147483648, false) THEN
    RAISE EXCEPTION 'invalid audio reference measurements';
  END IF;
  v_path := p_organization_id::text || '/' || p_revision_id::text || '/audio/' || p_visual_checksum || '/' || p_bundle_sha256 || '.zip';
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'composition-conformance-evidence' AND name = v_path) THEN
    RAISE EXCEPTION 'audio evidence object missing';
  END IF;
  INSERT INTO private.hyperframes_audio_conformance_evidence
    (revision_id, organization_id, visual_checksum, bundle_sha256, storage_path, file_size_bytes, receipt)
  VALUES (p_revision_id, p_organization_id, p_visual_checksum, p_bundle_sha256, v_path, p_file_size_bytes, p_receipt)
  ON CONFLICT (revision_id, bundle_sha256) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM private.hyperframes_audio_conformance_evidence e
    WHERE e.revision_id = p_revision_id AND e.bundle_sha256 = p_bundle_sha256 AND e.organization_id = p_organization_id
      AND e.visual_checksum = p_visual_checksum AND e.storage_path = v_path AND e.file_size_bytes = p_file_size_bytes AND e.receipt = p_receipt) THEN
    RAISE EXCEPTION 'audio evidence conflict';
  END IF;
  RETURN p_bundle_sha256;
END;
$$;
REVOKE ALL ON FUNCTION public.record_hyperframes_audio_conformance_evidence(uuid, uuid, text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_hyperframes_audio_conformance_evidence(uuid, uuid, text, text, bigint, jsonb) TO service_role;

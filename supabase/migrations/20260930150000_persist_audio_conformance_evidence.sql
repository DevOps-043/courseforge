-- Audio is a source-derived reference, never playback attestation or QA approval.
CREATE TABLE private.hyperframes_audio_conformance_evidence (
  revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  visual_checksum text NOT NULL,
  bundle_sha256 text NOT NULL CHECK (bundle_sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text NOT NULL UNIQUE,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 8388608),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (revision_id, bundle_sha256),
  FOREIGN KEY (revision_id, visual_checksum)
    REFERENCES private.hyperframes_visual_conformance_evidence(revision_id, bundle_sha256) ON DELETE CASCADE
);
ALTER TABLE private.hyperframes_audio_conformance_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.hyperframes_audio_conformance_evidence FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_hyperframes_audio_conformance_evidence(
  p_organization_id uuid, p_revision_id uuid, p_visual_checksum text,
  p_bundle_sha256 text, p_file_size_bytes bigint, p_receipt jsonb
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE v_revision public.video_composition_revisions%ROWTYPE; v_visual private.hyperframes_visual_conformance_evidence%ROWTYPE; v_path text;
BEGIN
  IF p_bundle_sha256 IS NULL OR p_bundle_sha256 !~ '^[a-f0-9]{64}$'
    OR p_visual_checksum IS NULL OR p_visual_checksum !~ '^[a-f0-9]{64}$'
    OR p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 OR p_file_size_bytes > 8388608
    OR p_receipt IS NULL OR jsonb_typeof(p_receipt) <> 'object' OR octet_length(p_receipt::text) > 65536 THEN
    RAISE EXCEPTION 'invalid audio evidence';
  END IF;
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
    OR p_receipt->>'schemaVersion' IS DISTINCT FROM '1'
    OR p_receipt->>'status' IS DISTINCT FROM 'SOURCE_MIX_REFERENCE_NOT_PLAYBACK_CAPTURE'
    OR p_receipt->>'method' IS DISTINCT FROM 'PREVIEW_RULES_STEREO_PCM_V1'
    OR p_receipt->>'audioEnvelopeVersion' IS DISTINCT FROM '2'
    OR p_receipt->>'sampleRate' IS DISTINCT FROM '8000'
    OR p_receipt->>'channels' IS DISTINCT FROM '2'
    OR coalesce(p_receipt->>'audioSha256', '') !~ '^[a-f0-9]{64}$'
    OR NOT (p_receipt ?& ARRAY['durationSeconds','peak','clipCount','decodedAssetCount','assetCount','mediaBytes']) THEN
    RAISE EXCEPTION 'audio evidence revision mismatch';
  END IF;
  IF (p_receipt->>'durationSeconds')::numeric IS DISTINCT FROM (v_revision.manifest->'conformance_contract'->'canvas'->>'durationSeconds')::numeric
    OR NOT coalesce((p_receipt->>'durationSeconds')::numeric > 0 AND (p_receipt->>'durationSeconds')::numeric <= 120, false)
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

CREATE FUNCTION public.read_hyperframes_audio_conformance_evidence(
  p_organization_id uuid, p_revision_id uuid, p_visual_checksum text, p_bundle_sha256 text
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
  SELECT jsonb_build_object('organizationId', e.organization_id, 'revisionId', e.revision_id,
    'projectHash', v.project_hash, 'documentHash', v.document_hash,
    'visualChecksum', e.visual_checksum, 'checksum', e.bundle_sha256, 'storagePath', e.storage_path,
    'sizeBytes', e.file_size_bytes, 'receipt', e.receipt, 'contract', r.manifest->'conformance_contract')
  FROM private.hyperframes_audio_conformance_evidence e
  JOIN private.hyperframes_visual_conformance_evidence v ON v.revision_id = e.revision_id
    AND v.bundle_sha256 = e.visual_checksum AND v.organization_id = e.organization_id
  JOIN public.video_composition_revisions r ON r.id = e.revision_id AND r.organization_id = e.organization_id
  WHERE e.organization_id = p_organization_id AND e.revision_id = p_revision_id
    AND e.visual_checksum = p_visual_checksum AND e.bundle_sha256 = p_bundle_sha256
    AND r.project_hash = v.project_hash AND r.manifest->>'conformance_reference_version' = '1'
    AND r.manifest->>'draft_document_hash' = v.document_hash
    AND r.manifest->'conformance_contract'->>'documentHash' = v.document_hash;
$$;
REVOKE ALL ON FUNCTION public.read_hyperframes_audio_conformance_evidence(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_hyperframes_audio_conformance_evidence(uuid, uuid, text, text) TO service_role;

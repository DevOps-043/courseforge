-- Prepared only. Separate from root visual/audio records; no QA or render approval.
CREATE TABLE private.hyperframes_event_visual_conformance_evidence (
  revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  batch_index integer NOT NULL CHECK (batch_index BETWEEN 0 AND 749),
  bundle_sha256 text NOT NULL CHECK (bundle_sha256 ~ '^[a-f0-9]{64}$'),
  project_hash text NOT NULL CHECK (project_hash ~ '^[a-f0-9]{64}$'),
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  storage_path text NOT NULL UNIQUE,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 150994944),
  frames jsonb NOT NULL CHECK (jsonb_typeof(frames) = 'array'),
  contract jsonb NOT NULL CHECK (jsonb_typeof(contract) = 'object'),
  lineage jsonb NOT NULL CHECK (jsonb_typeof(lineage) = 'object'),
  status text NOT NULL DEFAULT 'VISUAL_CAPTURED_AUDIO_PENDING' CHECK (status = 'VISUAL_CAPTURED_AUDIO_PENDING'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (revision_id, batch_index, bundle_sha256)
);
ALTER TABLE private.hyperframes_event_visual_conformance_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.hyperframes_event_visual_conformance_evidence FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_hyperframes_event_visual_conformance_evidence(
  p_organization_id uuid, p_revision_id uuid, p_project_hash text, p_document_hash text,
  p_bundle_sha256 text, p_file_size_bytes bigint, p_frames jsonb,
  p_batch_index integer, p_contract jsonb, p_lineage jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE v_revision public.video_composition_revisions%ROWTYPE; v_parent jsonb; v_authorization jsonb; v_path text;
BEGIN
  IF p_batch_index IS NULL OR p_batch_index NOT BETWEEN 0 AND 749
    OR p_bundle_sha256 IS NULL OR p_bundle_sha256 !~ '^[a-f0-9]{64}$'
    OR p_project_hash IS NULL OR p_project_hash !~ '^[a-f0-9]{64}$'
    OR p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$'
    OR p_file_size_bytes IS NULL OR p_file_size_bytes NOT BETWEEN 1 AND 150994944
    OR jsonb_typeof(p_contract) IS DISTINCT FROM 'object' OR octet_length(p_contract::text) > 1048576
    OR jsonb_typeof(p_lineage) IS DISTINCT FROM 'object' OR octet_length(p_lineage::text) > 4096
    OR jsonb_typeof(p_frames) IS DISTINCT FROM 'array' OR octet_length(p_frames::text) > 262144 THEN
    RAISE EXCEPTION 'invalid event conformance evidence';
  END IF;
  SELECT * INTO v_revision FROM public.video_composition_revisions
    WHERE id = p_revision_id AND organization_id = p_organization_id FOR SHARE;
  v_parent := v_revision.manifest->'conformance_contract';
  v_authorization := v_revision.manifest->'conformance_event_batch_authorization';
  IF v_revision.id IS NULL OR v_revision.project_hash IS DISTINCT FROM p_project_hash
    OR v_revision.manifest->>'conformance_reference_version' IS DISTINCT FROM '1'
    OR v_revision.manifest->>'draft_document_hash' IS DISTINCT FROM p_document_hash
    OR v_parent->>'documentHash' IS DISTINCT FROM p_document_hash
    OR v_parent->>'schemaVersion' IS DISTINCT FROM '4'
    OR v_parent->>'checkpointPolicy' IS DISTINCT FROM 'ALL_NATIVE_EVENT_NEIGHBORS_BATCHED_V1'
    OR v_authorization->>'schemaVersion' IS DISTINCT FROM '1'
    OR v_authorization->>'policy' IS DISTINCT FROM 'FROZEN_EVENT_PARTITION_CONTRACT_HASHES_V1'
    OR v_authorization->>'scope' IS DISTINCT FROM 'AUTHORIZED_CONTRACT_IDENTITIES_NOT_MEASUREMENT_COVERAGE'
    OR v_authorization->>'documentHash' IS DISTINCT FROM p_document_hash
    OR jsonb_typeof(v_authorization->'batchContractSha256') IS DISTINCT FROM 'array'
    OR v_authorization->'rootBatch' IS DISTINCT FROM v_parent->'checkpointBatch'
    OR v_parent#>>'{checkpointBatch,batchIndex}' IS DISTINCT FROM '0'
    OR p_contract#>>'{checkpointBatch,batchIndex}' IS DISTINCT FROM p_batch_index::text
    OR p_lineage->>'policy' IS DISTINCT FROM 'VERIFIED_ROOT_EVENT_PARTITION_V1'
    OR p_lineage->>'scope' IS DISTINCT FROM 'ONE_PREVIEW_PARTITION_NOT_GLOBAL_RENDER_ATTESTATION'
    OR p_lineage->'batch' IS DISTINCT FROM p_contract->'checkpointBatch'
    OR p_lineage->>'parentContractSha256' IS DISTINCT FROM v_authorization->>'parentContractSha256'
    OR (p_lineage->>'batchContractSha256') IS NULL
    OR p_lineage->>'batchContractSha256' IS DISTINCT FROM v_authorization->'batchContractSha256'->>p_batch_index
    OR (p_contract - 'checkpoints' - 'textParity' - 'checkpointBatch') IS DISTINCT FROM
       (v_parent - 'checkpoints' - 'textParity' - 'checkpointBatch')
    OR ((p_contract->'textParity') - 'checkpoints') IS DISTINCT FROM ((v_parent->'textParity') - 'checkpoints')
    OR ((p_contract->'checkpointBatch') - 'batchIndex') IS DISTINCT FROM ((v_parent->'checkpointBatch') - 'batchIndex')
    OR jsonb_typeof(p_contract->'checkpoints') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'event conformance authorization mismatch';
  END IF;
  IF jsonb_array_length(v_authorization->'batchContractSha256') NOT BETWEEN 1 AND 750
    OR jsonb_array_length(v_authorization->'batchContractSha256') <> (v_parent#>>'{checkpointBatch,batchCount}')::integer
    OR p_batch_index >= jsonb_array_length(v_authorization->'batchContractSha256')
    OR v_authorization->'batchContractSha256'->>0 IS DISTINCT FROM v_authorization->>'parentContractSha256'
    OR jsonb_array_length(p_frames) NOT BETWEEN 1 AND 48
    OR jsonb_array_length(p_frames) <> jsonb_array_length(p_contract->'checkpoints')
    OR jsonb_array_length(p_frames) <> LEAST(48, (v_parent#>>'{checkpointBatch,totalCheckpointCount}')::integer - p_batch_index * 48)
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_frames) AS f("frameIndex" integer, "timeSeconds" numeric, sha256 text, "sizeBytes" bigint)
      WHERE f."frameIndex" IS NULL OR f."frameIndex" < 0 OR f."timeSeconds" IS NULL OR f."timeSeconds" < 0
        OR f.sha256 IS NULL OR f.sha256 !~ '^[a-f0-9]{64}$' OR f."sizeBytes" IS NULL OR f."sizeBytes" NOT BETWEEN 1 AND 20971520)
    OR (SELECT sum((f->>'sizeBytes')::bigint) FROM jsonb_array_elements(p_frames) f) > 134217728
    OR (SELECT count(DISTINCT f->>'frameIndex') FROM jsonb_array_elements(p_frames) f) <> jsonb_array_length(p_frames)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_contract->'checkpoints') c WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_frames) f WHERE f->>'frameIndex' = c->>'frameIndex'
        AND abs((f->>'timeSeconds')::numeric - (c->>'timeSeconds')::numeric) <= 0.01)) THEN
    RAISE EXCEPTION 'event conformance checkpoints mismatch';
  END IF;
  -- Canonical JS contract SHA-256 is checked before upload and again by the private reader.
  -- PostgreSQL jsonb text has different canonicalization; never hash it as if it were JS JSON.
  v_path := p_organization_id::text || '/' || p_revision_id::text || '/' || p_bundle_sha256 || '.zip';
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'composition-conformance-evidence' AND name = v_path) THEN
    RAISE EXCEPTION 'event conformance object missing';
  END IF;
  INSERT INTO private.hyperframes_event_visual_conformance_evidence
    (revision_id, organization_id, batch_index, bundle_sha256, project_hash, document_hash, storage_path, file_size_bytes, frames, contract, lineage)
  VALUES (p_revision_id, p_organization_id, p_batch_index, p_bundle_sha256, p_project_hash, p_document_hash, v_path, p_file_size_bytes, p_frames, p_contract, p_lineage)
  ON CONFLICT (revision_id, batch_index, bundle_sha256) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM private.hyperframes_event_visual_conformance_evidence e
    WHERE e.revision_id = p_revision_id AND e.organization_id = p_organization_id AND e.batch_index = p_batch_index
      AND e.bundle_sha256 = p_bundle_sha256 AND e.project_hash = p_project_hash AND e.document_hash = p_document_hash
      AND e.file_size_bytes = p_file_size_bytes AND e.frames = p_frames AND e.contract = p_contract AND e.lineage = p_lineage) THEN
    RAISE EXCEPTION 'event conformance evidence conflict';
  END IF;
  RETURN p_bundle_sha256;
END;
$$;
REVOKE ALL ON FUNCTION public.record_hyperframes_event_visual_conformance_evidence(uuid, uuid, text, text, text, bigint, jsonb, integer, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_hyperframes_event_visual_conformance_evidence(uuid, uuid, text, text, text, bigint, jsonb, integer, jsonb, jsonb) TO service_role;

CREATE FUNCTION public.read_hyperframes_event_visual_conformance_evidence(
  p_organization_id uuid, p_revision_id uuid, p_bundle_sha256 text, p_batch_index integer
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
  SELECT jsonb_build_object('organizationId', e.organization_id, 'revisionId', e.revision_id,
    'checksum', e.bundle_sha256, 'projectHash', e.project_hash, 'documentHash', e.document_hash,
    'storagePath', e.storage_path, 'sizeBytes', e.file_size_bytes, 'frames', e.frames,
    'status', e.status, 'contract', e.contract, 'eventAuthorization', jsonb_build_object(
      'parentContract', r.manifest->'conformance_contract',
      'batchAuthorization', r.manifest->'conformance_event_batch_authorization', 'lineage', e.lineage))
  FROM private.hyperframes_event_visual_conformance_evidence e
  JOIN public.video_composition_revisions r ON r.id = e.revision_id AND r.organization_id = e.organization_id
  WHERE e.organization_id = p_organization_id AND e.revision_id = p_revision_id AND e.batch_index = p_batch_index
    AND e.bundle_sha256 = p_bundle_sha256 AND r.project_hash = e.project_hash
    AND r.manifest->>'conformance_reference_version' = '1'
    AND r.manifest->>'draft_document_hash' = e.document_hash
    AND r.manifest#>>'{conformance_contract,documentHash}' = e.document_hash
    AND r.manifest#>>'{conformance_event_batch_authorization,parentContractSha256}' = e.lineage->>'parentContractSha256'
    AND r.manifest->'conformance_event_batch_authorization'->'batchContractSha256'->>e.batch_index = e.lineage->>'batchContractSha256';
$$;
REVOKE ALL ON FUNCTION public.read_hyperframes_event_visual_conformance_evidence(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_hyperframes_event_visual_conformance_evidence(uuid, uuid, text, integer) TO service_role;

-- Rollback (after stopping event workers): export private records/objects, then drop the two
-- event RPCs and this event-only table. Root visual/audio records and storage objects are untouched.

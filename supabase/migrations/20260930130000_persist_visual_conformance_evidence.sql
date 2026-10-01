-- Private, worker-managed reference captures. This does not approve any render or audio.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('composition-conformance-evidence', 'composition-conformance-evidence', false, 150994944, ARRAY['application/zip']);

-- Restrictive policy prevents existing broad authenticated policies granting access to this bucket.
CREATE POLICY exclude_worker_conformance_evidence ON storage.objects AS RESTRICTIVE
FOR ALL TO anon, authenticated
USING (bucket_id <> 'composition-conformance-evidence')
WITH CHECK (bucket_id <> 'composition-conformance-evidence');

CREATE TABLE private.hyperframes_visual_conformance_evidence (
  revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bundle_sha256 text NOT NULL CHECK (bundle_sha256 ~ '^[a-f0-9]{64}$'),
  project_hash text NOT NULL CHECK (project_hash ~ '^[a-f0-9]{64}$'),
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  storage_path text NOT NULL UNIQUE,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 150994944),
  frames jsonb NOT NULL CHECK (jsonb_typeof(frames) = 'array'),
  status text NOT NULL DEFAULT 'VISUAL_CAPTURED_AUDIO_PENDING' CHECK (status = 'VISUAL_CAPTURED_AUDIO_PENDING'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (revision_id, bundle_sha256)
);
ALTER TABLE private.hyperframes_visual_conformance_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.hyperframes_visual_conformance_evidence FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_hyperframes_visual_conformance_evidence(
  p_organization_id uuid, p_revision_id uuid, p_project_hash text, p_document_hash text,
  p_bundle_sha256 text, p_file_size_bytes bigint, p_frames jsonb
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE v_revision public.video_composition_revisions%ROWTYPE; v_contract jsonb; v_path text;
BEGIN
  IF p_bundle_sha256 IS NULL OR p_bundle_sha256 !~ '^[a-f0-9]{64}$'
    OR p_project_hash IS NULL OR p_project_hash !~ '^[a-f0-9]{64}$'
    OR p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$'
    OR p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 OR p_file_size_bytes > 150994944
    OR p_frames IS NULL OR jsonb_typeof(p_frames) <> 'array' THEN RAISE EXCEPTION 'invalid conformance evidence'; END IF;
  SELECT * INTO v_revision FROM public.video_composition_revisions
  WHERE id = p_revision_id AND organization_id = p_organization_id FOR SHARE;
  v_contract := v_revision.manifest->'conformance_contract';
  IF v_revision.id IS NULL OR v_revision.project_hash IS DISTINCT FROM p_project_hash
    OR v_revision.manifest->>'conformance_reference_version' IS DISTINCT FROM '1'
    OR v_revision.manifest->>'draft_document_hash' IS DISTINCT FROM p_document_hash
    OR v_contract->>'documentHash' IS DISTINCT FROM p_document_hash
    OR jsonb_typeof(v_contract->'checkpoints') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'conformance revision mismatch';
  END IF;
  IF jsonb_array_length(p_frames) NOT BETWEEN 1 AND 48
    OR octet_length(p_frames::text) > 262144
    OR jsonb_array_length(p_frames) <> jsonb_array_length(v_contract->'checkpoints')
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_frames) AS f("frameIndex" integer, "timeSeconds" numeric, sha256 text, "sizeBytes" bigint)
      WHERE f."frameIndex" IS NULL OR f."frameIndex" < 0 OR f."timeSeconds" IS NULL OR f."timeSeconds" < 0
        OR f.sha256 IS NULL OR f.sha256 !~ '^[a-f0-9]{64}$' OR f."sizeBytes" IS NULL OR f."sizeBytes" <= 0 OR f."sizeBytes" > 20971520)
    OR (SELECT sum((f->>'sizeBytes')::bigint) FROM jsonb_array_elements(p_frames) f) > 134217728
    OR (SELECT count(DISTINCT f->>'frameIndex') FROM jsonb_array_elements(p_frames) f) <> jsonb_array_length(p_frames)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_contract->'checkpoints') c
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_frames) f
        WHERE f->>'frameIndex' = c->>'frameIndex' AND abs((f->>'timeSeconds')::numeric - (c->>'timeSeconds')::numeric) <= 0.01)) THEN
    RAISE EXCEPTION 'conformance checkpoints mismatch';
  END IF;
  v_path := p_organization_id::text || '/' || p_revision_id::text || '/' || p_bundle_sha256 || '.zip';
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'composition-conformance-evidence' AND name = v_path) THEN
    RAISE EXCEPTION 'conformance object missing';
  END IF;
  INSERT INTO private.hyperframes_visual_conformance_evidence
    (revision_id, organization_id, bundle_sha256, project_hash, document_hash, storage_path, file_size_bytes, frames)
  VALUES (p_revision_id, p_organization_id, p_bundle_sha256, p_project_hash, p_document_hash, v_path, p_file_size_bytes, p_frames)
  ON CONFLICT (revision_id, bundle_sha256) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM private.hyperframes_visual_conformance_evidence e
    WHERE e.revision_id = p_revision_id AND e.bundle_sha256 = p_bundle_sha256 AND e.organization_id = p_organization_id
      AND e.project_hash = p_project_hash AND e.document_hash = p_document_hash AND e.file_size_bytes = p_file_size_bytes AND e.frames = p_frames) THEN
    RAISE EXCEPTION 'conformance evidence conflict';
  END IF;
  RETURN p_bundle_sha256;
END;
$$;
REVOKE ALL ON FUNCTION public.record_hyperframes_visual_conformance_evidence(uuid, uuid, text, text, text, bigint, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_hyperframes_visual_conformance_evidence(uuid, uuid, text, text, text, bigint, jsonb) TO service_role;

-- Prepared only: resumable measurements, not render attestation or QA approval.
CREATE TABLE private.hyperframes_event_batch_measurements (
  identity jsonb PRIMARY KEY CHECK (jsonb_typeof(identity) = 'object' AND octet_length(identity::text) <= 2048),
  revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  batch_index integer NOT NULL CHECK (batch_index BETWEEN 0 AND 749),
  visual_sha256 text NOT NULL CHECK (visual_sha256 ~ '^[a-f0-9]{64}$'),
  packet_sha256 text NOT NULL CHECK (packet_sha256 ~ '^[a-f0-9]{64}$'),
  packet jsonb NOT NULL CHECK (jsonb_typeof(packet) = 'object' AND octet_length(packet::text) <= 4194304),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (revision_id, batch_index, visual_sha256)
    REFERENCES private.hyperframes_event_visual_conformance_evidence(revision_id, batch_index, bundle_sha256) ON DELETE CASCADE
);
ALTER TABLE private.hyperframes_event_batch_measurements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.hyperframes_event_batch_measurements FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_hyperframes_event_batch_measurement(
  p_identity jsonb, p_packet jsonb, p_packet_sha256 text, p_visual_sha256 text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE v_revision_id uuid; v_organization_id uuid; v_batch_index integer;
BEGIN
  IF jsonb_typeof(p_identity) IS DISTINCT FROM 'object' OR octet_length(p_identity::text) > 2048
    OR jsonb_typeof(p_packet) IS DISTINCT FROM 'object' OR octet_length(p_packet::text) > 4194304
    OR p_packet_sha256 IS NULL OR p_packet_sha256 !~ '^[a-f0-9]{64}$'
    OR p_visual_sha256 IS NULL OR p_visual_sha256 !~ '^[a-f0-9]{64}$'
    OR p_packet->>'schemaVersion' IS DISTINCT FROM '1'
    OR p_packet->>'scope' IS DISTINCT FROM 'EVENT_VISUAL_SAMPLE_PACKET_NOT_INDEPENDENT_ATTESTATION'
    OR p_packet->'identity' IS DISTINCT FROM p_identity
    OR jsonb_typeof(p_packet->'samples') IS DISTINCT FROM 'array'
    OR p_identity->>'videoSha256' IS NULL OR p_identity->>'videoSha256' !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid event measurement packet';
  END IF;
  IF jsonb_array_length(p_packet->'samples') > 48 THEN RAISE EXCEPTION 'event packet sample limit'; END IF;
  v_revision_id := (p_identity->>'revisionId')::uuid;
  v_organization_id := (p_identity->>'organizationId')::uuid;
  v_batch_index := (p_identity#>>'{batch,batchIndex}')::integer;
  IF v_batch_index IS NULL OR v_batch_index NOT BETWEEN 0 AND 749 THEN RAISE EXCEPTION 'invalid event batch index'; END IF;
  PERFORM 1 FROM public.video_composition_revisions r
    JOIN private.hyperframes_event_visual_conformance_evidence v
      ON v.revision_id = r.id AND v.organization_id = r.organization_id
    WHERE r.id = v_revision_id AND r.organization_id = v_organization_id
      AND v.batch_index = v_batch_index AND v.bundle_sha256 = p_visual_sha256
      AND r.project_hash = p_identity->>'projectHash' AND v.project_hash = r.project_hash
      AND r.manifest->>'conformance_reference_version' = '1'
      AND r.manifest->>'draft_document_hash' = p_identity->>'documentHash' AND v.document_hash = p_identity->>'documentHash'
      AND r.manifest#>>'{conformance_contract,documentHash}' = p_identity->>'documentHash'
      AND r.manifest#>>'{conformance_event_batch_authorization,parentContractSha256}' = p_identity->>'parentContractSha256'
      AND r.manifest->'conformance_event_batch_authorization'->'batchContractSha256'->>v_batch_index = p_identity->>'batchContractSha256'
      AND v.lineage->>'parentContractSha256' = p_identity->>'parentContractSha256'
      AND v.lineage->>'batchContractSha256' = p_identity->>'batchContractSha256'
      AND v.lineage->'batch' = p_identity->'batch'
    FOR SHARE OF r, v;
  IF NOT FOUND THEN RAISE EXCEPTION 'event packet reference authorization mismatch'; END IF;
  -- Worker and reader verify the canonical JS packet SHA-256; PostgreSQL jsonb text is not its representation.
  INSERT INTO private.hyperframes_event_batch_measurements
    (identity, revision_id, organization_id, batch_index, visual_sha256, packet_sha256, packet)
  VALUES (p_identity, v_revision_id, v_organization_id, v_batch_index, p_visual_sha256, p_packet_sha256, p_packet)
  ON CONFLICT (identity) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM private.hyperframes_event_batch_measurements e WHERE e.identity = p_identity
    AND e.packet_sha256 = p_packet_sha256 AND e.packet = p_packet AND e.visual_sha256 = p_visual_sha256) THEN
    RAISE EXCEPTION 'event packet immutable conflict';
  END IF;
  RETURN p_packet_sha256;
END;
$$;
REVOKE ALL ON FUNCTION public.record_hyperframes_event_batch_measurement(jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_hyperframes_event_batch_measurement(jsonb, jsonb, text, text) TO service_role;

CREATE FUNCTION public.read_hyperframes_event_batch_measurement(p_identity jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
  SELECT jsonb_build_object('packetSha256', e.packet_sha256, 'packet', e.packet)
  FROM private.hyperframes_event_batch_measurements e
  JOIN public.video_composition_revisions r ON r.id = e.revision_id AND r.organization_id = e.organization_id
  JOIN private.hyperframes_event_visual_conformance_evidence v ON v.revision_id = e.revision_id
    AND v.organization_id = e.organization_id AND v.batch_index = e.batch_index AND v.bundle_sha256 = e.visual_sha256
  WHERE e.identity = p_identity AND r.id = (p_identity->>'revisionId')::uuid
    AND r.organization_id = (p_identity->>'organizationId')::uuid
    AND r.project_hash = p_identity->>'projectHash' AND v.project_hash = r.project_hash
    AND r.manifest->>'conformance_reference_version' = '1'
    AND r.manifest->>'draft_document_hash' = p_identity->>'documentHash'
    AND r.manifest#>>'{conformance_contract,documentHash}' = p_identity->>'documentHash'
    AND v.document_hash = p_identity->>'documentHash'
    AND r.manifest#>>'{conformance_event_batch_authorization,parentContractSha256}' = p_identity->>'parentContractSha256'
    AND r.manifest->'conformance_event_batch_authorization'->'batchContractSha256'->>e.batch_index = p_identity->>'batchContractSha256'
    AND v.lineage->>'parentContractSha256' = p_identity->>'parentContractSha256'
    AND v.lineage->>'batchContractSha256' = p_identity->>'batchContractSha256'
    AND v.lineage->'batch' = p_identity->'batch';
$$;
REVOKE ALL ON FUNCTION public.read_hyperframes_event_batch_measurement(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_hyperframes_event_batch_measurement(jsonb) TO service_role;

-- Rollback: stop event workers, export packets, then drop these two RPCs and this packet-only table.
-- Visual/audio records and Storage objects remain untouched.

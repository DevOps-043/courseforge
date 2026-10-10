-- PREPARED ONLY. Independent, non-activating CAP029 historical registration.
-- Requires exact HTML/native readers, resource validator and archive identity RPC.
-- Trusted host verifies full schemas, compiled byte pins and create-only readback.
BEGIN;
CREATE TABLE private.composition_html_historical_candidates (
  organization_id uuid NOT NULL REFERENCES public.organizations(id), candidate_id uuid NOT NULL,
  composition_id uuid NOT NULL REFERENCES public.video_compositions(id), draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id), payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 16777216),
  revoked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (organization_id,candidate_id)
);
CREATE TABLE private.composition_html_historical_operations (
  organization_id uuid NOT NULL REFERENCES public.organizations(id), operation_id uuid NOT NULL,
  composition_id uuid NOT NULL REFERENCES public.video_compositions(id), draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id), candidate_id uuid NOT NULL,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK (octet_length(receipt::text) <= 4096), revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (organization_id,operation_id),
  UNIQUE (organization_id,candidate_id),
  FOREIGN KEY (organization_id,candidate_id) REFERENCES private.composition_html_historical_candidates(organization_id,candidate_id)
);
ALTER TABLE private.composition_html_historical_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.composition_html_historical_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_html_historical_candidates,private.composition_html_historical_operations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.assert_html_historical_scope(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_composition IS NULL OR p_draft IS NULL THEN RAISE EXCEPTION 'HTML_HISTORICAL_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft AND organization_id = p_org
    AND composition_id = p_composition AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_HISTORICAL_FORBIDDEN'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  PERFORM 1 FROM public.video_compositions WHERE id = p_composition AND organization_id = p_org AND status <> 'ARCHIVED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_HISTORICAL_FORBIDDEN'; END IF;
END $$;

CREATE FUNCTION private.validate_html_historical_candidate(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE provenance jsonb := p_payload->'provenance'; archive jsonb := p_payload->'archive'; prepared jsonb := p_payload->'prepared';
  approval jsonb := p_payload->'approval'; original jsonb; exact_read jsonb; bindings jsonb;
BEGIN
  PERFORM private.assert_html_historical_scope(p_org,p_actor,p_composition,p_draft);
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::text) > 16777216
    OR provenance->>'organizationId' IS DISTINCT FROM p_org::text OR provenance->>'compositionId' IS DISTINCT FROM p_composition::text
    OR provenance->>'draftId' IS DISTINCT FROM p_draft::text
    OR provenance->>'publicationMode' IS DISTINCT FROM 'HISTORICAL_REVISION_WITHOUT_ACTIVATION_OR_DRAFT_CHANGE'
    OR provenance->>'candidateId' IS NULL OR provenance->>'originalRevisionId' IS NULL
    OR provenance->>'documentId' IS NULL
    OR coalesce(provenance->>'documentHash','') !~ '^[a-f0-9]{64}$'
    OR coalesce(provenance->>'originalProjectHash','') !~ '^[a-f0-9]{64}$'
    OR coalesce(provenance->>'originalBundleSha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(provenance->>'candidateBundleSha256','') !~ '^[a-f0-9]{64}$'
    OR p_payload->>'candidateSha256' IS NULL OR p_payload->>'candidateSha256' !~ '^[a-f0-9]{64}$'
    OR approval->>'reviewerId' IS NULL OR approval->>'evidenceSha256' IS NULL OR approval->>'evidenceSha256' !~ '^[a-f0-9]{64}$'
    OR approval->'completedReviews' IS DISTINCT FROM '["HISTORICAL_VISUAL_COMPARISON","CURRENT_CONTENT_AND_ACCESSIBILITY","AUTHORIZED_REPUBLICATION"]'::jsonb
    OR archive->>'projectHash' IS NULL OR archive->>'projectHash' !~ '^[a-f0-9]{64}$'
    OR archive->>'projectHash' IS DISTINCT FROM approval->>'reviewedProjectHash'
    OR archive->>'projectHash' IS DISTINCT FROM prepared->>'projectHash'
    OR archive->>'projectHash' IS NOT DISTINCT FROM provenance->>'originalProjectHash'
    OR archive->>'sizeBytes' IS NULL OR archive->>'sizeBytes' !~ '^[0-9]{1,9}$'
    OR (archive->>'sizeBytes')::bigint NOT BETWEEN 1 AND 209715200
    OR archive->>'storageBucket' IS DISTINCT FROM 'production-assets'
    OR archive->>'storagePath' IS DISTINCT FROM ('composition-snapshots/'||p_org::text||'/'||p_composition::text||'/'||(archive->>'projectHash')||'.zip')
    OR prepared->>'scope' IS DISTINCT FROM 'PREPARED_ARCHIVE_NOT_UPLOADED_OR_RENDERED'
    OR prepared->>'documentHash' IS DISTINCT FROM provenance->>'documentHash'
    OR prepared#>>'{bundle,sha256}' IS DISTINCT FROM provenance->>'candidateBundleSha256'
    OR prepared#>>'{bundle,archivePath}' IS DISTINCT FROM 'html-editing-revisions.json'
    OR prepared#>>'{contract,schemaVersion}' IS DISTINCT FROM '4'
    OR prepared#>>'{contract,documentHash}' IS DISTINCT FROM provenance->>'documentHash'
    OR prepared#>>'{contract,renderExecution,backend}' IS DISTINCT FROM 'CONTROLLED'
    OR prepared#>>'{metadata,htmlEditingSnapshot,sha256}' IS DISTINCT FROM provenance->>'candidateBundleSha256'
    THEN RAISE EXCEPTION 'HTML_HISTORICAL_CANDIDATE_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,(approval->>'reviewerId')::uuid);
  original := public.read_html_editing_snapshot_archive(p_org,p_actor,p_composition,p_draft,(provenance->>'originalRevisionId')::uuid);
  IF original->>'projectHash' IS DISTINCT FROM provenance->>'originalProjectHash'
    OR original#>>'{bundlePin,sha256}' IS DISTINCT FROM provenance->>'originalBundleSha256'
    OR original->>'documentId' IS DISTINCT FROM provenance->>'documentId'
    OR original->>'documentHash' IS DISTINCT FROM provenance->>'documentHash' THEN RAISE EXCEPTION 'HTML_HISTORICAL_ORIGINAL_CHANGED'; END IF;
  exact_read := public.read_html_editing_compilation(p_org,(provenance->>'documentId')::uuid,p_actor,provenance->>'documentHash');
  bindings := private.html_snapshot_resource_bindings(p_org,(provenance->>'documentId')::uuid,prepared->'assets',prepared->'fontManifest');
  RETURN jsonb_build_object('exact',exact_read,'bindings',bindings);
END $$;

CREATE FUNCTION public.record_html_historical_candidate(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,p_candidate uuid,p_payload jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_historical_candidates%ROWTYPE; inserted integer;
BEGIN
  IF p_candidate IS NULL OR p_payload#>>'{provenance,candidateId}' IS DISTINCT FROM p_candidate::text
    OR p_payload#>>'{approval,reviewerId}' IS DISTINCT FROM p_actor::text THEN RAISE EXCEPTION 'HTML_HISTORICAL_INVALID'; END IF;
  PERFORM private.validate_html_historical_candidate(p_org,p_actor,p_composition,p_draft,p_payload);
  INSERT INTO private.composition_html_historical_candidates(organization_id,candidate_id,composition_id,draft_id,reviewer_id,payload)
    VALUES(p_org,p_candidate,p_composition,p_draft,p_actor,p_payload) ON CONFLICT (organization_id,candidate_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  SELECT * INTO stored FROM private.composition_html_historical_candidates WHERE organization_id = p_org AND candidate_id = p_candidate FOR SHARE;
  IF stored.revoked OR stored.payload IS DISTINCT FROM p_payload OR stored.composition_id IS DISTINCT FROM p_composition
    OR stored.draft_id IS DISTINCT FROM p_draft OR stored.reviewer_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'HTML_HISTORICAL_CANDIDATE_CONFLICT'; END IF;
  RETURN inserted = 1;
END $$;

CREATE FUNCTION public.read_html_historical_candidate(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,p_candidate uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_historical_candidates%ROWTYPE;
BEGIN
  PERFORM private.assert_html_historical_scope(p_org,p_actor,p_composition,p_draft);
  IF EXISTS (SELECT 1 FROM private.composition_html_historical_operations WHERE organization_id = p_org AND candidate_id = p_candidate)
    THEN RAISE EXCEPTION 'HTML_HISTORICAL_CANDIDATE_ALREADY_REGISTERED'; END IF;
  SELECT * INTO stored FROM private.composition_html_historical_candidates WHERE organization_id = p_org AND candidate_id = p_candidate
    AND composition_id = p_composition AND draft_id = p_draft AND NOT revoked FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_HISTORICAL_CANDIDATE_FORBIDDEN'; END IF;
  PERFORM private.validate_html_historical_candidate(p_org,p_actor,p_composition,p_draft,stored.payload);
  RETURN stored.payload;
END $$;

CREATE FUNCTION public.revoke_html_historical_candidate(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,p_candidate uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
BEGIN
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft AND organization_id = p_org AND state = 'ACTIVE' FOR UPDATE NOWAIT;
  PERFORM private.assert_html_historical_scope(p_org,p_actor,p_composition,p_draft);
  UPDATE private.composition_html_historical_candidates SET revoked = true WHERE organization_id = p_org
    AND composition_id = p_composition AND draft_id = p_draft AND candidate_id = p_candidate;
  RETURN FOUND;
END $$;

CREATE FUNCTION public.commit_html_historical_publication(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,p_operation uuid,
  p_request_sha256 text,p_request jsonb,p_registration jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_historical_candidates%ROWTYPE; previous private.composition_html_historical_operations%ROWTYPE;
  composition public.video_compositions%ROWTYPE; revision public.video_composition_revisions%ROWTYPE;
  validation jsonb; provenance jsonb; manifest jsonb; archive jsonb; grants jsonb; bindings jsonb; binding jsonb;
  next_number integer; receipt jsonb; native_hash text;
BEGIN
  IF p_operation IS NULL OR p_request_sha256 IS NULL OR p_request_sha256 !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::text) > 1024
    OR jsonb_typeof(p_registration) IS DISTINCT FROM 'object' OR octet_length(p_registration::text) > 16777216 THEN RAISE EXCEPTION 'HTML_HISTORICAL_INVALID'; END IF;
  -- Draft-first lock order. Serialize revision numbering with ordinary publication,
  -- but NEVER change the current native document, draft state or active revision.
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft AND organization_id = p_org
    AND composition_id = p_composition AND state = 'ACTIVE' FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_HISTORICAL_FORBIDDEN'; END IF;
  PERFORM private.assert_html_historical_scope(p_org,p_actor,p_composition,p_draft);
  SELECT * INTO composition FROM public.video_compositions WHERE id = p_composition AND organization_id = p_org AND status <> 'ARCHIVED' FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_HISTORICAL_FORBIDDEN'; END IF;
  SELECT * INTO previous FROM private.composition_html_historical_operations WHERE organization_id = p_org AND operation_id = p_operation FOR SHARE;
  IF FOUND THEN
    IF previous.actor_id IS DISTINCT FROM p_actor OR previous.composition_id IS DISTINCT FROM p_composition
      OR previous.draft_id IS DISTINCT FROM p_draft OR previous.request_sha256 IS DISTINCT FROM p_request_sha256
      OR previous.receipt->'request' IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'HTML_HISTORICAL_OPERATION_CONFLICT'; END IF;
    RETURN previous.receipt;
  END IF;
  SELECT * INTO stored FROM private.composition_html_historical_candidates WHERE organization_id = p_org
    AND candidate_id = (p_request->>'candidateId')::uuid AND composition_id = p_composition AND draft_id = p_draft AND NOT revoked FOR SHARE;
  IF NOT FOUND OR stored.payload->>'candidateSha256' IS DISTINCT FROM p_request->>'candidateSha256' THEN RAISE EXCEPTION 'HTML_HISTORICAL_CANDIDATE_FORBIDDEN'; END IF;
  validation := private.validate_html_historical_candidate(p_org,p_actor,p_composition,p_draft,stored.payload);
  provenance := stored.payload->'provenance'; archive := stored.payload->'archive'; manifest := p_registration->'manifest';
  IF p_registration->'archive' IS DISTINCT FROM archive OR manifest->'historical_html_republication' IS DISTINCT FROM provenance
    OR manifest->'snapshot' IS DISTINCT FROM 'true'::jsonb OR manifest->>'draft_document_id' IS DISTINCT FROM provenance->>'documentId'
    OR manifest->>'draft_document_hash' IS DISTINCT FROM provenance->>'documentHash'
    OR manifest->'asset_manifest' IS DISTINCT FROM stored.payload#>'{prepared,assets}'
    OR manifest->'font_manifest' IS DISTINCT FROM stored.payload#>'{prepared,fontManifest}'
    OR manifest->'conformance_contract' IS DISTINCT FROM stored.payload#>'{prepared,contract}'
    OR manifest->'conformance_reference' IS DISTINCT FROM stored.payload#>'{prepared,metadata}'
    OR manifest->'html_editing_snapshot' IS DISTINCT FROM stored.payload#>'{prepared,metadata,htmlEditingSnapshot}'
    OR jsonb_typeof(p_registration->'htmlUsedAssetIds') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_registration->'htmlUsedAssetIds') > 250 THEN RAISE EXCEPTION 'HTML_HISTORICAL_REGISTRATION_INVALID'; END IF;
  SELECT coalesce(jsonb_agg(DISTINCT id),'[]'::jsonb) INTO grants FROM
    jsonb_array_elements(validation#>'{exact,revisions}') r,jsonb_array_elements_text(r->'grantedAssetIds') g(id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_registration->'htmlUsedAssetIds') u(id) WHERE NOT (grants ? u.id)
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(manifest->'asset_manifest') a WHERE a->>'productionAssetId' = u.id
      AND a->>'mimeType' IN ('image/png','image/jpeg','image/webp'))) THEN RAISE EXCEPTION 'HTML_HISTORICAL_GRANT_REVOKED'; END IF;
  SELECT coalesce(max(revision_number),0) + 1 INTO next_number FROM public.video_composition_revisions WHERE composition_id = p_composition;
  -- No silent reuse: candidate provenance gives a separate content-addressed ZIP.
  -- A conflicting project hash fails atomically rather than mutating an old row.
  INSERT INTO public.video_composition_revisions(composition_id,organization_id,revision_number,generation_mode,format,entry_point,
    project_storage_bucket,project_storage_path,project_archive_size_bytes,project_hash,variables_schema,variables_values,manifest,created_by)
  VALUES(p_composition,p_org,next_number,'AUTOMATIC','hyperframes-html-v1','index.html',archive->>'storageBucket',archive->>'storagePath',
    (archive->>'sizeBytes')::bigint,archive->>'projectHash','[]'::jsonb,coalesce(validation#>'{exact,document,variables}','{}'::jsonb),manifest,p_actor)
  RETURNING * INTO revision;
  bindings := validation->'bindings';
  -- Current resource provenance links are inserted with the revision/receipt in
  -- this same transaction. Their identities came from the shared locked validator.
  FOR binding IN SELECT e FROM jsonb_array_elements(bindings) e LOOP
    IF binding->>'origin' = 'PRODUCTION' THEN
      INSERT INTO public.video_composition_assets(composition_revision_id,organization_id,production_asset_id,role,source_checksum,source_storage_path,file_size_bytes,mime_type)
      VALUES(revision.id,p_org,(binding->>'productionAssetId')::uuid,CASE WHEN binding->>'mimeType' LIKE 'audio/%' THEN 'AUDIO'
        WHEN binding->>'mimeType' LIKE 'video/%' THEN 'VIDEO' ELSE 'IMAGE' END,binding->>'checksum',binding->>'storagePath',
        (binding->>'fileSizeBytes')::bigint,binding->>'mimeType');
    ELSIF binding->>'origin' = 'BRANDING' THEN
      INSERT INTO public.video_composition_brand_assets(composition_revision_id,organization_id,organization_assembly_asset_id,role,
        source_checksum,source_storage_bucket,source_storage_path,file_size_bytes,mime_type)
      VALUES(revision.id,p_org,(binding->>'productionAssetId')::uuid,'VIDEO',binding->>'checksum',binding->>'storageBucket',binding->>'storagePath',
        (binding->>'fileSizeBytes')::bigint,binding->>'mimeType');
    ELSIF binding->>'origin' = 'SOUND_EFFECT' THEN
      INSERT INTO public.video_composition_sound_effect_assets(composition_revision_id,organization_id,sound_effect_asset_id,source_checksum,source_storage_path,file_size_bytes,mime_type)
      VALUES(revision.id,p_org,(binding->>'productionAssetId')::uuid,binding->>'checksum',binding->>'storagePath',
        (binding->>'fileSizeBytes')::bigint,binding->>'mimeType');
    ELSE RAISE EXCEPTION 'HTML_HISTORICAL_BINDING_INVALID'; END IF;
  END LOOP;
  SELECT document_hash INTO native_hash FROM public.video_composition_draft_documents WHERE draft_id = p_draft AND organization_id = p_org
    ORDER BY version DESC LIMIT 1 FOR SHARE;
  receipt := jsonb_build_object('scope','HISTORICAL_PUBLICATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED',
    'organizationId',p_org,'compositionId',p_composition,'draftId',p_draft,'actorId',p_actor,'operationId',p_operation,
    'request',p_request,'requestSha256',p_request_sha256,'originalRevisionId',provenance->>'originalRevisionId',
    'originalProjectHash',provenance->>'originalProjectHash','projectHash',archive->>'projectHash',
    'revisionId',revision.id,'revisionNumber',revision.revision_number,'activeRevisionIdAtCommit',composition.active_revision_id,
    'currentDraftHashAtCommit',native_hash,'activated',false,'draftChanged',false);
  INSERT INTO private.composition_html_historical_operations(organization_id,operation_id,composition_id,draft_id,actor_id,candidate_id,
    request_sha256,receipt,revision_id) VALUES(p_org,p_operation,p_composition,p_draft,p_actor,stored.candidate_id,p_request_sha256,receipt,revision.id);
  RETURN receipt;
END $$;

CREATE FUNCTION public.read_html_historical_publication_operation(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,p_operation uuid,p_request_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_historical_operations%ROWTYPE;
BEGIN
  IF p_operation IS NULL OR p_request_sha256 IS NULL OR p_request_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'HTML_HISTORICAL_INVALID'; END IF;
  PERFORM private.assert_html_historical_scope(p_org,p_actor,p_composition,p_draft);
  SELECT * INTO stored FROM private.composition_html_historical_operations WHERE organization_id = p_org AND operation_id = p_operation FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  IF stored.actor_id IS DISTINCT FROM p_actor OR stored.composition_id IS DISTINCT FROM p_composition
    OR stored.draft_id IS DISTINCT FROM p_draft OR stored.request_sha256 IS DISTINCT FROM p_request_sha256 THEN RAISE EXCEPTION 'HTML_HISTORICAL_OPERATION_FORBIDDEN'; END IF;
  PERFORM 1 FROM public.video_composition_revisions WHERE id = stored.revision_id AND organization_id = p_org AND composition_id = p_composition
    AND project_hash = stored.receipt->>'projectHash' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_HISTORICAL_RECEIPT_INVALID'; END IF;
  -- Receipt describes this operation's commit instant, not today's active state,
  -- source access, template approval or execution authority. No compiler here.
  RETURN jsonb_build_object('status','RECORDED','receipt',stored.receipt);
END $$;
REVOKE ALL ON FUNCTION private.assert_html_historical_scope(uuid,uuid,uuid,uuid),
  private.validate_html_historical_candidate(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_html_historical_candidate(uuid,uuid,uuid,uuid,uuid,jsonb),
  public.read_html_historical_candidate(uuid,uuid,uuid,uuid,uuid),public.revoke_html_historical_candidate(uuid,uuid,uuid,uuid,uuid),
  public.commit_html_historical_publication(uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb),
  public.read_html_historical_publication_operation(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_html_historical_candidate(uuid,uuid,uuid,uuid,uuid,jsonb),
  public.read_html_historical_candidate(uuid,uuid,uuid,uuid,uuid),public.revoke_html_historical_candidate(uuid,uuid,uuid,uuid,uuid),
  public.commit_html_historical_publication(uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb),
  public.read_html_historical_publication_operation(uuid,uuid,uuid,uuid,uuid,text) TO service_role;
COMMIT;

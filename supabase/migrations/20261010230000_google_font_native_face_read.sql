-- Exact native selections; no latest-bundle fallback or uploaded relabeling.
-- Requires candidate bundles and decoded admission. Service-only authority read.
BEGIN;
CREATE FUNCTION public.read_ready_google_font_faces(p_org uuid,p_face_ids uuid[],p_font uuid,p_bundle uuid,p_candidate_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE selected record; object_metadata jsonb; object_path text; result jsonb:='[]'::jsonb; expected integer;
BEGIN
  IF p_org IS NULL THEN RAISE EXCEPTION 'GOOGLE_FONT_NATIVE_SELECTION_INVALID'; END IF;
  IF p_face_ids IS NOT NULL THEN
    IF p_font IS NOT NULL OR p_bundle IS NOT NULL OR p_candidate_sha256 IS NOT NULL
      OR cardinality(p_face_ids) NOT BETWEEN 1 AND 32
      OR cardinality(p_face_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_face_ids) id)
      THEN RAISE EXCEPTION 'GOOGLE_FONT_NATIVE_SELECTION_INVALID'; END IF;
    expected:=cardinality(p_face_ids);
  ELSE
    IF p_font IS NULL OR p_bundle IS NULL OR p_candidate_sha256 IS NULL OR p_candidate_sha256 !~ '^[a-f0-9]{64}$'
      THEN RAISE EXCEPTION 'GOOGLE_FONT_NATIVE_SELECTION_INVALID'; END IF;
    SELECT jsonb_array_length(b.manifest->'faces') INTO expected FROM public.organization_google_font_bundles b
      WHERE b.organization_id=p_org AND b.font_id=p_font AND b.id=p_bundle AND b.candidate_sha256=p_candidate_sha256;
    IF expected IS NULL OR expected NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE'; END IF;
  END IF;
  -- Locks are only held for a short metadata read, never during decoding/network.
  FOR selected IN SELECT f.*,b.registration_css_url,b.manifest,a.status AS admission_status,
      a.proof,a.candidate_sha256 AS admission_hash,b.candidate_sha256 AS bundle_hash,b.status AS bundle_status,
      r.css_url,r.family AS registered_family,r.status AS registration_status,r.source
    FROM public.organization_google_font_faces f
    JOIN public.organization_google_font_admissions a ON a.id=f.admission_id AND a.organization_id=f.organization_id
      AND a.font_id=f.font_id AND a.bundle_id=f.bundle_id
    JOIN public.organization_google_font_bundles b ON b.id=f.bundle_id AND b.organization_id=f.organization_id AND b.font_id=f.font_id
    JOIN public.organization_slide_fonts r ON r.id=f.font_id AND r.organization_id=f.organization_id
    JOIN public.organizations o ON o.id=f.organization_id AND o.is_active IS TRUE
    WHERE f.organization_id=p_org AND (p_face_ids IS NOT NULL AND f.id=ANY(p_face_ids)
      OR p_face_ids IS NULL AND f.font_id=p_font AND f.bundle_id=p_bundle AND f.candidate_sha256=p_candidate_sha256)
    ORDER BY f.id FOR SHARE OF f,a,b,r,o LOOP
    IF selected.admission_status IS DISTINCT FROM 'READY' OR selected.bundle_status IS DISTINCT FROM 'PREPARED'
      OR selected.registration_status IS DISTINCT FROM 'READY' OR selected.source IS DISTINCT FROM 'google'
      OR selected.registration_css_url IS DISTINCT FROM selected.css_url
      OR selected.family IS DISTINCT FROM selected.registered_family
      OR selected.candidate_sha256 IS DISTINCT FROM selected.admission_hash
      OR selected.candidate_sha256 IS DISTINCT FROM selected.bundle_hash
      OR selected.candidate_sha256 IS DISTINCT FROM selected.proof->>'candidateSha256'
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(selected.manifest->'faces') e WHERE e=selected.face)
      THEN RAISE EXCEPTION 'GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE'; END IF;
    object_path:=p_org::text||'/google-candidates/'||selected.candidate_sha256||'/'||
      (selected.face->>'checksumSha256')||'.'||substring(selected.face->>'mimeType' FROM 6);
    SELECT o.metadata INTO object_metadata FROM storage.objects o WHERE o.bucket_id='organization-fonts' AND o.name=object_path FOR SHARE;
    IF NOT FOUND OR object_metadata->>'size' IS DISTINCT FROM selected.face->>'fileSizeBytes'
      OR object_metadata->>'mimetype' IS DISTINCT FROM selected.face->>'mimeType'
      THEN RAISE EXCEPTION 'GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE'; END IF;
    result:=result||jsonb_build_array(jsonb_build_object('id',selected.id,'organizationId',p_org,'admissionId',selected.admission_id,
      'pin',jsonb_build_object('fontId',selected.font_id,'bundleId',selected.bundle_id,'candidateSha256',selected.candidate_sha256),
      'family',selected.family,'face',selected.face));
  END LOOP;
  IF jsonb_array_length(result)<>expected THEN RAISE EXCEPTION 'GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_ready_google_font_faces(uuid,uuid[],uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_ready_google_font_faces(uuid,uuid[],uuid,uuid,text) TO service_role;
COMMIT;

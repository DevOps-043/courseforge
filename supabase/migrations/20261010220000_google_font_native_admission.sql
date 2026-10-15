-- Decoded Google candidates: independent native admission, never uploaded aliases.
-- Requires 20261010210000_google_font_candidate_bundles.sql. No render-policy relaxation.
BEGIN;
CREATE TABLE public.organization_google_font_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  font_id uuid NOT NULL REFERENCES public.organization_slide_fonts(id),
  bundle_id uuid NOT NULL UNIQUE REFERENCES public.organization_google_font_bundles(id),
  candidate_sha256 text NOT NULL CHECK (candidate_sha256 ~ '^[a-f0-9]{64}$'),
  proof_text text NOT NULL CHECK (octet_length(proof_text) BETWEEN 1 AND 262144),
  proof jsonb NOT NULL CHECK (proof=proof_text::jsonb),
  status text NOT NULL DEFAULT 'READY' CHECK (status IN ('READY','REVOKED')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.organization_google_font_faces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  font_id uuid NOT NULL REFERENCES public.organization_slide_fonts(id),
  admission_id uuid NOT NULL REFERENCES public.organization_google_font_admissions(id),
  bundle_id uuid NOT NULL REFERENCES public.organization_google_font_bundles(id),
  candidate_sha256 text NOT NULL CHECK (candidate_sha256 ~ '^[a-f0-9]{64}$'),
  family text NOT NULL CHECK (char_length(family) BETWEEN 1 AND 120),
  face jsonb NOT NULL CHECK (jsonb_typeof(face)='object'),
  coverage jsonb NOT NULL CHECK (jsonb_typeof(coverage)='array' AND jsonb_array_length(coverage) BETWEEN 1 AND 8192),
  UNIQUE (bundle_id,face)
);
CREATE INDEX google_font_admission_current ON public.organization_google_font_admissions(organization_id,font_id,created_at DESC) WHERE status='READY';
CREATE INDEX google_font_face_inventory ON public.organization_google_font_faces(organization_id,font_id,bundle_id);
ALTER TABLE public.organization_google_font_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_google_font_faces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_google_font_admissions,public.organization_google_font_faces FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.organization_google_font_admissions,public.organization_google_font_faces TO service_role;

CREATE FUNCTION private.prevent_google_font_admission_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
    OR OLD.status='REVOKED' AND NEW.status IS DISTINCT FROM 'REVOKED'
    THEN RAISE EXCEPTION 'GOOGLE_FONT_ADMISSION_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.prevent_google_font_admission_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER google_font_admission_immutable BEFORE UPDATE ON public.organization_google_font_admissions
  FOR EACH ROW EXECUTE FUNCTION private.prevent_google_font_admission_change();
-- A separate trigger avoids referencing a status column absent from face records.
CREATE FUNCTION private.prevent_google_font_face_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'GOOGLE_FONT_ADMISSION_IMMUTABLE'; END $$;
REVOKE ALL ON FUNCTION private.prevent_google_font_face_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER google_font_face_immutable BEFORE UPDATE ON public.organization_google_font_faces
  FOR EACH ROW EXECUTE FUNCTION private.prevent_google_font_face_change();

CREATE FUNCTION public.admit_decoded_google_font_bundle(p_org uuid,p_actor uuid,p_font uuid,p_bundle uuid,p_candidate_sha256 text,p_proof_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE bundle public.organization_google_font_bundles%ROWTYPE; font public.organization_slide_fonts%ROWTYPE;
  admission public.organization_google_font_admissions%ROWTYPE; proof jsonb; supplied jsonb; entry jsonb;
  metadata jsonb; face jsonb; path text; object_metadata jsonb; inserted_id uuid; faces jsonb;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_font IS NULL OR p_bundle IS NULL OR p_candidate_sha256 IS NULL
    OR p_candidate_sha256 !~ '^[a-f0-9]{64}$' OR p_proof_text IS NULL OR octet_length(p_proof_text) NOT BETWEEN 1 AND 262144
    THEN RAISE EXCEPTION 'GOOGLE_FONT_ADMISSION_INVALID'; END IF;
  PERFORM 1 FROM public.organization_user_roles r JOIN public.profiles p ON p.id=r.user_id
    JOIN public.organizations o ON o.id=r.organization_id WHERE r.organization_id=p_org AND r.user_id=p_actor
    AND r.platform_role::text IN ('ADMIN','SUPERADMIN') AND p.is_active IS TRUE AND o.is_active IS TRUE FOR SHARE OF r,p,o;
  IF NOT FOUND THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_ACTOR_FORBIDDEN'; END IF;
  SELECT * INTO font FROM public.organization_slide_fonts f WHERE f.id=p_font AND f.organization_id=p_org FOR SHARE;
  IF NOT FOUND OR font.source IS DISTINCT FROM 'google' OR font.status IS DISTINCT FROM 'READY'
    THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_REGISTRATION_CHANGED'; END IF;
  SELECT * INTO bundle FROM public.organization_google_font_bundles b WHERE b.id=p_bundle AND b.organization_id=p_org
    AND b.font_id=p_font AND b.candidate_sha256=p_candidate_sha256 FOR SHARE;
  IF NOT FOUND OR bundle.status IS DISTINCT FROM 'PREPARED' OR bundle.registration_css_url IS DISTINCT FROM font.css_url
    OR bundle.manifest->>'family' IS DISTINCT FROM font.family THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_REGISTRATION_CHANGED'; END IF;
  proof:=p_proof_text::jsonb;
  IF jsonb_typeof(proof) IS DISTINCT FROM 'object'
    OR proof-ARRAY['format','decoder','bundleId','candidateSha256','family','files'] <> '{}'::jsonb
    OR proof->>'format' IS DISTINCT FROM 'courseforge-decoded-google-font-bundle-v1'
    OR proof->>'decoder' IS DISTINCT FROM 'fontkit-2.0.4' OR proof->>'bundleId' IS DISTINCT FROM p_bundle::text
    OR proof->>'candidateSha256' IS DISTINCT FROM p_candidate_sha256 OR proof->>'family' IS DISTINCT FROM font.family
    OR jsonb_typeof(proof->'files') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'GOOGLE_FONT_ADMISSION_INVALID'; END IF;
  IF jsonb_array_length(proof->'files')<>jsonb_array_length(bundle.manifest->'files')
    OR jsonb_array_length(proof->'files')<>(SELECT count(DISTINCT e->>'checksumSha256') FROM jsonb_array_elements(proof->'files') e)
    THEN RAISE EXCEPTION 'GOOGLE_FONT_ADMISSION_INVALID'; END IF;
  FOR entry IN SELECT e FROM jsonb_array_elements(bundle.manifest->'files') e ORDER BY e->>'checksumSha256' LOOP
    SELECT e INTO supplied FROM jsonb_array_elements(proof->'files') e WHERE e->>'checksumSha256'=entry->>'checksumSha256';
    IF supplied IS NULL OR supplied-ARRAY['checksumSha256','metadata']<>'{}'::jsonb THEN RAISE EXCEPTION 'GOOGLE_FONT_ADMISSION_INVALID'; END IF;
    metadata:=supplied->'metadata';
    IF jsonb_typeof(metadata) IS DISTINCT FROM 'object'
      OR metadata-ARRAY['family','style','weight','axes','glyphCount','coverage','decodedBytes','embedding']<>'{}'::jsonb
      OR metadata->>'family' IS DISTINCT FROM font.family OR metadata->>'embedding' IS DISTINCT FROM 'EDITABLE_TABLE_FLAGS'
      OR coalesce(metadata->>'style','') NOT IN ('normal','italic') OR jsonb_typeof(metadata->'axes') IS DISTINCT FROM 'object'
      OR jsonb_typeof(metadata->'coverage') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'GOOGLE_FONT_ADMISSION_INVALID'; END IF;
    IF coalesce(metadata->>'weight','')!~'^[0-9]{1,4}$' OR (metadata->>'weight')::integer NOT BETWEEN 1 AND 1000
      OR coalesce(metadata->>'glyphCount','')!~'^[0-9]{1,5}$' OR (metadata->>'glyphCount')::integer NOT BETWEEN 1 AND 65535
      OR coalesce(metadata->>'decodedBytes','')!~'^[0-9]{1,8}$' OR (metadata->>'decodedBytes')::bigint NOT BETWEEN 1 AND 33554432
      OR jsonb_array_length(metadata->'coverage') NOT BETWEEN 1 AND 8192 THEN RAISE EXCEPTION 'GOOGLE_FONT_ADMISSION_INVALID'; END IF;
    -- This RPC trusts only the authenticated decoder service for binary/outline checks.
    -- SQL itself does not decode Storage bytes or certify rendering/glyph usage.
    path:=p_org::text||'/google-candidates/'||p_candidate_sha256||'/'||(entry->>'checksumSha256')||'.'||substring(entry->>'mimeType' FROM 6);
    SELECT o.metadata INTO object_metadata FROM storage.objects o WHERE o.bucket_id='organization-fonts' AND o.name=path FOR SHARE;
    IF NOT FOUND OR object_metadata->>'size' IS DISTINCT FROM entry->>'fileSizeBytes'
      OR object_metadata->>'mimetype' IS DISTINCT FROM entry->>'mimeType' THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_STORAGE_UNAVAILABLE'; END IF;
    FOR face IN SELECT e FROM jsonb_array_elements(bundle.manifest->'faces') e WHERE e->>'checksumSha256'=entry->>'checksumSha256' LOOP
      IF face->>'style' IS DISTINCT FROM metadata->>'style' THEN RAISE EXCEPTION 'GOOGLE_FONT_ADMISSION_INVALID'; END IF;
      IF NOT(metadata->'axes' ? 'wght') AND (face#>>'{weight,minimum}' IS DISTINCT FROM metadata->>'weight'
        OR face#>>'{weight,maximum}' IS DISTINCT FROM metadata->>'weight') THEN RAISE EXCEPTION 'GOOGLE_FONT_ADMISSION_INVALID'; END IF;
    END LOOP;
  END LOOP;
  INSERT INTO public.organization_google_font_admissions(organization_id,font_id,bundle_id,candidate_sha256,proof_text,proof,created_by)
    VALUES(p_org,p_font,p_bundle,p_candidate_sha256,p_proof_text,proof,p_actor)
    ON CONFLICT (bundle_id) DO NOTHING RETURNING id INTO inserted_id;
  SELECT * INTO admission FROM public.organization_google_font_admissions a WHERE a.bundle_id=p_bundle FOR SHARE;
  IF admission.organization_id IS DISTINCT FROM p_org OR admission.font_id IS DISTINCT FROM p_font
    OR admission.candidate_sha256 IS DISTINCT FROM p_candidate_sha256 OR admission.proof_text IS DISTINCT FROM p_proof_text
    THEN RAISE EXCEPTION 'GOOGLE_FONT_ADMISSION_INVALID'; END IF;
  IF admission.status IS DISTINCT FROM 'READY' THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_REVOKED'; END IF;
  IF inserted_id IS NOT NULL THEN
    FOR face IN SELECT e FROM jsonb_array_elements(bundle.manifest->'faces') e LOOP
      SELECT e->'metadata' INTO metadata FROM jsonb_array_elements(proof->'files') e WHERE e->>'checksumSha256'=face->>'checksumSha256';
      INSERT INTO public.organization_google_font_faces(organization_id,font_id,admission_id,bundle_id,candidate_sha256,family,face,coverage)
        VALUES(p_org,p_font,admission.id,p_bundle,p_candidate_sha256,font.family,face,metadata->'coverage');
    END LOOP;
  END IF;
  SELECT jsonb_agg(f.id ORDER BY f.id) INTO faces FROM public.organization_google_font_faces f WHERE f.admission_id=admission.id;
  IF faces IS NULL OR jsonb_array_length(faces)<>jsonb_array_length(bundle.manifest->'faces') THEN RAISE EXCEPTION 'GOOGLE_FONT_ADMISSION_INVALID'; END IF;
  RETURN jsonb_build_object('admissionId',admission.id,'bundleId',bundle.id,'fontId',font.id,'candidateSha256',p_candidate_sha256,
    'status','READY','faceIds',faces,'created',inserted_id IS NOT NULL,'scope','DECODED_FONT_FILES_NOT_RENDER_ATTESTATION');
END $$;
REVOKE ALL ON FUNCTION public.admit_decoded_google_font_bundle(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admit_decoded_google_font_bundle(uuid,uuid,uuid,uuid,text,text) TO service_role;
COMMIT;

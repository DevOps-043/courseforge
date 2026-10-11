-- Prepared only. Structural candidates are NOT native-font grants or READY assets.
-- No changes to existing uploaded font admission, CAP-025 stores or render guards.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE public.organization_google_font_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  font_id uuid NOT NULL REFERENCES public.organization_slide_fonts(id),
  candidate_sha256 text NOT NULL CHECK (candidate_sha256 ~ '^[a-f0-9]{64}$'),
  manifest_text text NOT NULL CHECK (octet_length(manifest_text) BETWEEN 1 AND 262144),
  manifest jsonb NOT NULL,
  registration_css_url text NOT NULL CHECK (char_length(registration_css_url) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','REVOKED')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_font_bundle_text_hash CHECK (
    manifest = manifest_text::jsonb AND encode(pg_catalog.sha256(convert_to(manifest_text,'UTF8')),'hex') = candidate_sha256),
  CONSTRAINT google_font_bundle_identity UNIQUE (organization_id,font_id,candidate_sha256)
);
ALTER TABLE public.organization_google_font_bundles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_google_font_bundles FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.organization_google_font_bundles TO service_role;

-- Content is immutable. Revocation can be added without rewriting the receipt.
CREATE FUNCTION private.prevent_google_font_bundle_content_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.font_id IS DISTINCT FROM OLD.font_id OR NEW.candidate_sha256 IS DISTINCT FROM OLD.candidate_sha256
    OR NEW.manifest_text IS DISTINCT FROM OLD.manifest_text OR NEW.manifest IS DISTINCT FROM OLD.manifest
    OR NEW.registration_css_url IS DISTINCT FROM OLD.registration_css_url OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.status = 'REVOKED' AND NEW.status <> 'REVOKED'
    THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.prevent_google_font_bundle_content_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER google_font_bundle_immutable BEFORE UPDATE ON public.organization_google_font_bundles
  FOR EACH ROW EXECUTE FUNCTION private.prevent_google_font_bundle_content_change();

CREATE FUNCTION public.commit_google_font_candidate_bundle(p_org uuid,p_actor uuid,p_font uuid,p_family text,
  p_css_url text,p_candidate_sha256 text,p_manifest_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET lock_timeout = '2s' AS $$
DECLARE font public.organization_slide_fonts%ROWTYPE; bundle public.organization_google_font_bundles%ROWTYPE;
  manifest jsonb; entry jsonb; object_record record; object_path text; total_bytes bigint := 0; inserted_id uuid;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_font IS NULL OR p_family IS NULL OR p_css_url IS NULL
    OR p_candidate_sha256 IS NULL OR p_candidate_sha256 !~ '^[a-f0-9]{64}$' OR p_manifest_text IS NULL
    OR octet_length(p_manifest_text) NOT BETWEEN 1 AND 262144
    OR encode(pg_catalog.sha256(convert_to(p_manifest_text,'UTF8')),'hex') IS DISTINCT FROM p_candidate_sha256
    THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_INVALID'; END IF;
  -- Reauthorize actor at commit; do not rely on a prior HTTP role check.
  PERFORM 1 FROM public.organization_user_roles r JOIN public.profiles p ON p.id=r.user_id
    JOIN public.organizations o ON o.id=r.organization_id WHERE r.user_id=p_actor AND r.organization_id=p_org
    AND r.platform_role::text IN ('ADMIN','SUPERADMIN') AND p.is_active IS TRUE AND o.is_active IS TRUE FOR SHARE OF r,p,o;
  IF NOT FOUND THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_ACTOR_FORBIDDEN'; END IF;
  SELECT * INTO font FROM public.organization_slide_fonts f WHERE f.id=p_font AND f.organization_id=p_org FOR SHARE;
  IF NOT FOUND OR font.source IS DISTINCT FROM 'google' OR font.status IS DISTINCT FROM 'READY'
    OR font.family IS DISTINCT FROM p_family OR font.css_url IS DISTINCT FROM p_css_url
    THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_REGISTRATION_CHANGED'; END IF;
  manifest := p_manifest_text::jsonb;
  IF jsonb_typeof(manifest) IS DISTINCT FROM 'object'
    OR manifest - ARRAY['format','source','family','stylesheetChecksumSha256','files','faces'] <> '{}'::jsonb
    OR manifest->>'format' IS DISTINCT FROM 'courseforge-google-font-candidate-bundle-v1'
    OR manifest->>'source' IS DISTINCT FROM 'google' OR manifest->>'family' IS DISTINCT FROM font.family
    OR coalesce(manifest->>'stylesheetChecksumSha256','') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(manifest->'files') IS DISTINCT FROM 'array' OR jsonb_typeof(manifest->'faces') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_INVALID'; END IF;
  IF jsonb_array_length(manifest->'files') NOT BETWEEN 1 AND 32 OR jsonb_array_length(manifest->'faces') NOT BETWEEN 1 AND 32
    OR jsonb_array_length(manifest->'files') <> (SELECT count(DISTINCT e->>'checksumSha256') FROM jsonb_array_elements(manifest->'files') e)
    OR jsonb_array_length(manifest->'faces') <> (SELECT count(DISTINCT jsonb_build_array(e->'style',e->'weight',e->'unicodeRange')) FROM jsonb_array_elements(manifest->'faces') e)
    THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_INVALID'; END IF;
  -- Order object locks by hash. Paths are reconstructed, never accepted from a client.
  -- Parenthesize CASE below so its THEN does not terminate the PL/pgSQL IF expression.
  FOR entry IN SELECT e FROM jsonb_array_elements(manifest->'files') e ORDER BY e->>'checksumSha256' LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR entry - ARRAY['checksumSha256','fileSizeBytes','mimeType','embeddingCheck'] <> '{}'::jsonb
      OR jsonb_typeof(entry->'checksumSha256') IS DISTINCT FROM 'string' OR jsonb_typeof(entry->'fileSizeBytes') IS DISTINCT FROM 'number'
      OR coalesce(entry->>'checksumSha256','') !~ '^[a-f0-9]{64}$' OR coalesce(entry->>'fileSizeBytes','') !~ '^[0-9]{1,8}$'
      OR (entry->>'fileSizeBytes')::bigint NOT BETWEEN 1 AND 10485760
      OR coalesce(entry->>'mimeType','') NOT IN ('font/woff','font/woff2','font/ttf','font/otf')
      OR entry->>'embeddingCheck' IS DISTINCT FROM (CASE WHEN entry->>'mimeType' IN ('font/woff','font/woff2') THEN 'UNVERIFIED_COMPRESSED' ELSE 'ALLOWED' END)
      THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_INVALID'; END IF;
    total_bytes := total_bytes+(entry->>'fileSizeBytes')::bigint;
    IF total_bytes > 20971520 THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_INVALID'; END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(manifest->'faces') face WHERE face->>'checksumSha256'=entry->>'checksumSha256')
      THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_INVALID'; END IF;
    object_path := p_org::text||'/google-candidates/'||p_candidate_sha256||'/'||(entry->>'checksumSha256')||'.'||substring(entry->>'mimeType' FROM 6);
    SELECT metadata INTO object_record FROM storage.objects WHERE bucket_id='organization-fonts' AND name=object_path FOR SHARE;
    IF NOT FOUND OR object_record.metadata->>'size' IS DISTINCT FROM entry->>'fileSizeBytes'
      OR object_record.metadata->>'mimetype' IS DISTINCT FROM entry->>'mimeType'
      THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_STORAGE_UNAVAILABLE'; END IF;
  END LOOP;
  FOR entry IN SELECT e FROM jsonb_array_elements(manifest->'faces') e LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object'
      OR entry - ARRAY['style','weight','unicodeRange','checksumSha256','fileSizeBytes','mimeType','embeddingCheck'] <> '{}'::jsonb
      OR coalesce(entry->>'style','') NOT IN ('normal','italic') OR jsonb_typeof(entry->'weight') IS DISTINCT FROM 'object'
      OR (entry->'weight') - ARRAY['minimum','maximum'] <> '{}'::jsonb
      OR jsonb_typeof(entry#>'{weight,minimum}') IS DISTINCT FROM 'number' OR jsonb_typeof(entry#>'{weight,maximum}') IS DISTINCT FROM 'number'
      OR coalesce(entry#>>'{weight,minimum}','') !~ '^[0-9]{1,4}$' OR coalesce(entry#>>'{weight,maximum}','') !~ '^[0-9]{1,4}$'
      OR (entry#>>'{weight,minimum}')::integer NOT BETWEEN 1 AND 1000 OR (entry#>>'{weight,maximum}')::integer NOT BETWEEN 1 AND 1000
      OR (entry#>>'{weight,minimum}')::integer > (entry#>>'{weight,maximum}')::integer
      OR NOT(entry ? 'unicodeRange') OR jsonb_typeof(entry->'unicodeRange') NOT IN ('null','string')
      OR jsonb_typeof(entry->'unicodeRange') = 'string' AND char_length(entry->>'unicodeRange') NOT BETWEEN 1 AND 4096
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(manifest->'files') f WHERE f=entry-ARRAY['style','weight','unicodeRange'])
      THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_INVALID'; END IF;
  END LOOP;
  INSERT INTO public.organization_google_font_bundles(organization_id,font_id,candidate_sha256,manifest_text,manifest,registration_css_url,created_by)
    VALUES(p_org,p_font,p_candidate_sha256,p_manifest_text,manifest,p_css_url,p_actor)
    ON CONFLICT (organization_id,font_id,candidate_sha256) DO NOTHING RETURNING id INTO inserted_id;
  SELECT * INTO bundle FROM public.organization_google_font_bundles b WHERE b.organization_id=p_org AND b.font_id=p_font
    AND b.candidate_sha256=p_candidate_sha256 FOR SHARE;
  IF bundle.status IS DISTINCT FROM 'PREPARED' THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_REVOKED'; END IF;
  IF bundle.manifest_text IS DISTINCT FROM p_manifest_text OR bundle.registration_css_url IS DISTINCT FROM p_css_url
    THEN RAISE EXCEPTION 'GOOGLE_FONT_BUNDLE_REGISTRATION_CHANGED'; END IF;
  RETURN jsonb_build_object('bundleId',bundle.id,'candidateSha256',bundle.candidate_sha256,'status','PREPARED','renderEligible',false,'created',inserted_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.commit_google_font_candidate_bundle(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_google_font_candidate_bundle(uuid,uuid,uuid,text,text,text,text) TO service_role;
COMMIT;

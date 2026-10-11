-- Add Google native variants to HTML resource admission without changing media
-- or uploaded-font authority. Requires 20261010230000 and existing HTML guards.
BEGIN;
-- Retain the installed uploaded/media validator as a private compatibility
-- delegate. Replacing the original function below keeps its OID for all callers.
DO $$
DECLARE definition text; copied text;
BEGIN
  definition:=pg_get_functiondef('private.html_snapshot_resource_bindings(uuid,uuid,jsonb,jsonb)'::regprocedure);
  copied:=replace(definition,'FUNCTION private.html_snapshot_resource_bindings(',
    'FUNCTION private.html_snapshot_uploaded_resource_bindings(');
  IF copied=definition THEN RAISE EXCEPTION 'HTML_UPLOADED_RESOURCE_DELEGATE_UNAVAILABLE'; END IF;
  EXECUTE copied;
END $$;
REVOKE ALL ON FUNCTION private.html_snapshot_uploaded_resource_bindings(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.assert_google_snapshot_font_bindings(p_org uuid,p_fonts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE ids uuid[]; faces jsonb; native jsonb; supplied jsonb; expected jsonb;
BEGIN
  IF p_org IS NULL OR jsonb_typeof(p_fonts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fonts)>32
    OR jsonb_array_length(p_fonts)<>(SELECT count(DISTINCT e->>'fontAssetId') FROM jsonb_array_elements(p_fonts) e)
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_RESOURCES_INVALID'; END IF;
  IF jsonb_array_length(p_fonts)=0 THEN RETURN; END IF;
  SELECT array_agg((e->>'fontAssetId')::uuid ORDER BY e->>'fontAssetId') INTO ids FROM jsonb_array_elements(p_fonts) e;
  -- This service-only read checks/locks registry, bundle, admission and Storage
  -- in the same transaction as the outer revision operation.
  faces:=public.read_ready_google_font_faces(p_org,ids,NULL,NULL,NULL);
  FOR native IN SELECT e FROM jsonb_array_elements(faces) e LOOP
    SELECT e INTO supplied FROM jsonb_array_elements(p_fonts) e WHERE e->>'fontAssetId'=native->>'id';
    expected:=jsonb_build_object('fontAssetId',native->>'id','family',native->>'family',
      'checksumSha256',native#>>'{face,checksumSha256}','fileSizeBytes',native#>'{face,fileSizeBytes}',
      'mimeType',native#>>'{face,mimeType}','googleFace',(native->'pin')||jsonb_build_object(
        'admissionId',native->>'admissionId','style',native#>>'{face,style}',
        'weight',native#>'{face,weight}','unicodeRange',native#>'{face,unicodeRange}'));
    IF supplied IS DISTINCT FROM expected THEN RAISE EXCEPTION 'HTML_SNAPSHOT_FONT_IDENTITY_CHANGED'; END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.assert_google_snapshot_font_bindings(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.html_snapshot_resource_bindings(p_org uuid,p_draft uuid,p_assets jsonb,p_fonts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE google_fonts jsonb; uploaded_fonts jsonb; bindings jsonb;
BEGIN
  IF p_fonts IS NULL OR jsonb_typeof(p_fonts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fonts)>32
    OR jsonb_array_length(p_fonts)<>(SELECT count(DISTINCT e->>'fontAssetId') FROM jsonb_array_elements(p_fonts) e)
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_RESOURCES_INVALID'; END IF;
  SELECT coalesce(jsonb_agg(e ORDER BY e->>'fontAssetId'),'[]'::jsonb) INTO google_fonts FROM jsonb_array_elements(p_fonts) e WHERE e ? 'googleFace';
  SELECT coalesce(jsonb_agg(e ORDER BY e->>'fontAssetId'),'[]'::jsonb) INTO uploaded_fonts FROM jsonb_array_elements(p_fonts) e WHERE NOT(e ? 'googleFace');
  bindings:=private.html_snapshot_uploaded_resource_bindings(p_org,p_draft,p_assets,uploaded_fonts);
  PERFORM private.assert_google_snapshot_font_bindings(p_org,google_fonts);
  RETURN bindings;
END $$;
REVOKE ALL ON FUNCTION private.html_snapshot_resource_bindings(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

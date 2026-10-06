-- PREPARED ONLY. Per-copy guard; membership, links/groups and atomic commit remain separate.
BEGIN;
CREATE FUNCTION private.validate_narrative_fragment_clip(p_original jsonb,p_copy jsonb,
  p_start numeric,p_end numeric,p_destination numeric,p_command uuid,p_ordinal integer,
  p_is_anchor boolean,p_asset_duration bigint,p_linked_scene text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  intersection_start numeric; intersection_end numeric; expected_offset numeric; expected_id text;
  time_tolerance CONSTANT numeric := 0.000001;
  mutable_fields CONSTANT text[] := ARRAY['id','hfId','sceneId','label','startSeconds','durationSeconds','timingSource','sourceOffsetSeconds','sourceDurationSeconds','source'];
BEGIN
  IF p_original IS NULL OR p_copy IS NULL OR p_command IS NULL OR p_ordinal IS NULL OR p_ordinal NOT BETWEEN 0 AND 47
    OR p_start IS NULL OR p_end IS NULL OR p_destination IS NULL OR p_is_anchor IS NULL
    OR p_start<0 OR p_end<=p_start OR p_end-p_start>120 OR p_destination<0
    OR jsonb_typeof(p_original->'startSeconds') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_original->'durationSeconds') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_copy->'startSeconds') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_copy->'durationSeconds') IS DISTINCT FROM 'number'
    OR coalesce((p_original->>'hidden')::boolean,false)
    OR coalesce((p_original->>'playbackRate')::numeric,1)<>1
    OR coalesce((p_original->>'freezeTailSeconds')::numeric,0)<>0
    OR coalesce((p_original->>'fadeInSeconds')::numeric,0)>0
    OR coalesce((p_original->>'fadeOutSeconds')::numeric,0)>0 THEN RETURN false; END IF;
  intersection_start := greatest(p_start,(p_original->>'startSeconds')::numeric);
  intersection_end := least(p_end,(p_original->>'startSeconds')::numeric+(p_original->>'durationSeconds')::numeric);
  IF intersection_end<=intersection_start THEN RETURN false; END IF;
  expected_id := CASE WHEN p_is_anchor THEN 'voice-extract-'||p_command::text ELSE 'fragment-'||p_command::text||'-'||p_ordinal::text END;
  IF p_copy->>'id' IS DISTINCT FROM expected_id
    OR p_copy->>'hfId' IS DISTINCT FROM 'hf-fragment-'||p_command::text||'-'||p_ordinal::text
    OR p_copy->>'label' IS DISTINCT FROM left(p_original->>'label',85)||' · fragmento'
    OR p_copy->>'timingSource' IS DISTINCT FROM 'USER_EDITED'
    OR p_copy->>'sceneId' IS DISTINCT FROM p_linked_scene
    OR (p_linked_scene IS NULL AND p_copy ? 'sceneId')
    OR (p_linked_scene IS NOT NULL AND p_linked_scene !~ ('^fragment-scene-'||p_command::text||'-[0-9]+$'))
    OR p_copy-mutable_fields IS DISTINCT FROM p_original-mutable_fields
    OR abs((p_copy->>'startSeconds')::numeric-(p_destination+intersection_start-p_start))>time_tolerance
    OR abs((p_copy->>'durationSeconds')::numeric-(intersection_end-intersection_start))>time_tolerance
    OR (p_copy->>'durationSeconds')::numeric<=0 THEN RETURN false; END IF;
  IF p_original#>>'{source,type}'='PRODUCTION_ASSET' THEN
    IF coalesce(p_original->>'kind','') NOT IN ('AUDIO','VIDEO','IMAGE') OR p_copy->'source' IS DISTINCT FROM p_original->'source' THEN RETURN false; END IF;
    IF p_original->>'kind'<>'IMAGE' THEN
      expected_offset := coalesce((p_original->>'sourceOffsetSeconds')::numeric,0)+intersection_start-(p_original->>'startSeconds')::numeric;
      IF p_asset_duration IS NULL OR p_asset_duration<=0 OR expected_offset<0
        OR expected_offset+intersection_end-intersection_start>p_asset_duration::numeric/1000
        OR jsonb_typeof(p_copy->'sourceOffsetSeconds') IS DISTINCT FROM 'number'
        OR jsonb_typeof(p_copy->'sourceDurationSeconds') IS DISTINCT FROM 'number'
        OR abs((p_copy->>'sourceOffsetSeconds')::numeric-expected_offset)>time_tolerance
        OR abs((p_copy->>'sourceDurationSeconds')::numeric-p_asset_duration::numeric/1000)>time_tolerance THEN RETURN false; END IF;
      RETURN true;
    END IF;
  ELSIF p_original#>>'{source,type}'='NATIVE_TEXT' THEN
    IF p_copy->'source' IS DISTINCT FROM p_original->'source' THEN RETURN false; END IF;
  ELSIF p_original#>>'{source,type}'='NATIVE_CAPTIONS' THEN
    IF NOT private.validate_narrative_fragment_caption(p_original->'source',p_copy->'source',
      intersection_start-(p_original->>'startSeconds')::numeric,intersection_end-(p_original->>'startSeconds')::numeric,
      p_command,p_ordinal) THEN RETURN false; END IF;
  ELSE RETURN false;
  END IF;
  -- Static/native layers retain source-offset fields exactly; they are not temporal production takes.
  RETURN (p_copy->'sourceOffsetSeconds' IS NOT DISTINCT FROM p_original->'sourceOffsetSeconds')
    AND (p_copy->'sourceDurationSeconds' IS NOT DISTINCT FROM p_original->'sourceDurationSeconds');
END $$;
REVOKE ALL ON FUNCTION private.validate_narrative_fragment_clip(jsonb,jsonb,numeric,numeric,numeric,uuid,integer,boolean,bigint,text)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

CREATE OR REPLACE FUNCTION public.merge_material_component_scene_assets(
  p_component_id uuid,
  p_assets_patch jsonb DEFAULT '{}'::jsonb,
  p_avatar_clips jsonb DEFAULT NULL,
  p_voice_clips jsonb DEFAULT NULL,
  p_remove_avatar_clip_ids jsonb DEFAULT '[]'::jsonb,
  p_remove_voice_clip_ids jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_assets jsonb;
  v_avatar_clips jsonb;
  v_voice_clips jsonb;
  v_item jsonb;
  v_key text;
BEGIN
  IF p_assets_patch IS NULL OR jsonb_typeof(p_assets_patch) <> 'object' THEN
    RAISE EXCEPTION 'p_assets_patch must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF p_avatar_clips IS NOT NULL AND jsonb_typeof(p_avatar_clips) <> 'array' THEN
    RAISE EXCEPTION 'p_avatar_clips must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_voice_clips IS NOT NULL AND jsonb_typeof(p_voice_clips) <> 'array' THEN
    RAISE EXCEPTION 'p_voice_clips must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_remove_avatar_clip_ids) <> 'array'
     OR jsonb_typeof(p_remove_voice_clip_ids) <> 'array' THEN
    RAISE EXCEPTION 'scene removal identifiers must be JSON arrays' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(assets, '{}'::jsonb)
  INTO v_assets
  FROM public.material_components
  WHERE id = p_component_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'material component not found' USING ERRCODE = 'P0002';
  END IF;

  v_avatar_clips := CASE
    WHEN jsonb_typeof(v_assets->'avatar_clips') = 'array' THEN v_assets->'avatar_clips'
    ELSE '[]'::jsonb
  END;
  v_voice_clips := CASE
    WHEN jsonb_typeof(v_assets->'voice_clips') = 'array' THEN v_assets->'voice_clips'
    ELSE '[]'::jsonb
  END;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_avatar_clips, '[]'::jsonb))
  LOOP
    v_key := NULLIF(BTRIM(v_item->>'id'), '');
    IF jsonb_typeof(v_item) <> 'object' OR v_key IS NULL THEN
      RAISE EXCEPTION 'every avatar clip patch must contain id' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
    INTO v_avatar_clips
    FROM jsonb_array_elements(v_avatar_clips)
    WHERE value->>'id' IS DISTINCT FROM v_key;
    v_avatar_clips := v_avatar_clips || jsonb_build_array(v_item);
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_voice_clips, '[]'::jsonb))
  LOOP
    v_key := NULLIF(BTRIM(v_item->>'clip_id'), '');
    IF jsonb_typeof(v_item) <> 'object' OR v_key IS NULL THEN
      RAISE EXCEPTION 'every voice clip patch must contain clip_id' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
    INTO v_voice_clips
    FROM jsonb_array_elements(v_voice_clips)
    WHERE value->>'clip_id' IS DISTINCT FROM v_key;
    v_voice_clips := v_voice_clips || jsonb_build_array(v_item);
  END LOOP;

  SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
  INTO v_avatar_clips
  FROM jsonb_array_elements(v_avatar_clips)
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(p_remove_avatar_clip_ids) removed(id)
    WHERE removed.id = value->>'id'
  );

  SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
  INTO v_voice_clips
  FROM jsonb_array_elements(v_voice_clips)
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(p_remove_voice_clip_ids) removed(id)
    WHERE removed.id = value->>'clip_id'
  );

  SELECT COALESCE(jsonb_agg(value ORDER BY CASE
    WHEN value->>'order' ~ '^[1-9][0-9]*$' THEN (value->>'order')::integer
    ELSE 2147483647
  END, value->>'id'), '[]'::jsonb)
  INTO v_avatar_clips
  FROM jsonb_array_elements(v_avatar_clips);

  SELECT COALESCE(jsonb_agg(value ORDER BY CASE
    WHEN value->>'order' ~ '^[1-9][0-9]*$' THEN (value->>'order')::integer
    ELSE 2147483647
  END, value->>'clip_id'), '[]'::jsonb)
  INTO v_voice_clips
  FROM jsonb_array_elements(v_voice_clips);

  v_assets := (v_assets || (p_assets_patch - 'avatar_clips' - 'voice_clips'))
    || jsonb_build_object(
      'avatar_clips', v_avatar_clips,
      'voice_clips', v_voice_clips
    );

  UPDATE public.material_components
  SET assets = v_assets
  WHERE id = p_component_id;

  RETURN v_assets;
END;
$$;

COMMENT ON FUNCTION public.merge_material_component_scene_assets(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) IS
  'Atomically patches scene media by avatar id and voice clip_id so concurrent HeyGen workers cannot replace unrelated clips.';

REVOKE ALL ON FUNCTION public.merge_material_component_scene_assets(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_material_component_scene_assets(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.merge_material_component_scene_assets(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;

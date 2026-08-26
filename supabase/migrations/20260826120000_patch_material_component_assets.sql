-- Merge production asset changes while holding the row lock.  Several production
-- flows (slides, uploads and provider callbacks) can update the same component at
-- once; a client-side read/merge/write can otherwise discard a sibling asset.
CREATE OR REPLACE FUNCTION public.patch_material_component_assets(
  p_component_id uuid,
  p_assets_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_assets jsonb;
  v_delete_keys text[];
BEGIN
  IF p_assets_patch IS NULL OR jsonb_typeof(p_assets_patch) <> 'object' THEN
    RAISE EXCEPTION 'p_assets_patch must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(entry.key), ARRAY[]::text[])
  INTO v_delete_keys
  FROM jsonb_each(p_assets_patch) AS entry
  WHERE entry.value = 'null'::jsonb;

  UPDATE public.material_components
  SET assets = (COALESCE(assets, '{}'::jsonb) || p_assets_patch) - v_delete_keys
  WHERE id = p_component_id
  RETURNING assets INTO v_assets;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'material component % not found', p_component_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_assets;
END;
$$;

COMMENT ON FUNCTION public.patch_material_component_assets(uuid, jsonb) IS
  'Atomically merges top-level production asset fields and returns the resulting assets JSON.';

REVOKE ALL ON FUNCTION public.patch_material_component_assets(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patch_material_component_assets(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patch_material_component_assets(uuid, jsonb) TO service_role;

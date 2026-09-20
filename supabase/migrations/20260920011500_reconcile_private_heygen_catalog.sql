-- Public HeyGen libraries contain thousands of provider-wide presets and are
-- not organization-owned inventory. Reconcile private account resources
-- authoritatively while preserving public/legacy rows as a discovery cache.

CREATE OR REPLACE FUNCTION public.reconcile_heygen_private_catalog_snapshot(
  p_organization_id uuid,
  p_sync_run_id uuid,
  p_synced_at timestamptz,
  p_account_snapshot jsonb,
  p_avatars jsonb,
  p_voices jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_avatar_cache_state jsonb := '[]'::jsonb;
  v_missing_avatars integer := 0;
  v_missing_voices integer := 0;
  v_result jsonb;
  v_voice_cache_state jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'is_default', is_default,
    'missing_since', missing_since,
    'provider_state', provider_state,
    'updated_at', updated_at
  )), '[]'::jsonb)
  INTO v_avatar_cache_state
  FROM public.heygen_avatar_presets
  WHERE organization_id = p_organization_id
    AND ownership IS DISTINCT FROM 'private';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'is_default', is_default,
    'missing_since', missing_since,
    'provider_state', provider_state,
    'updated_at', updated_at
  )), '[]'::jsonb)
  INTO v_voice_cache_state
  FROM public.heygen_voice_presets
  WHERE organization_id = p_organization_id
    AND ownership IS DISTINCT FROM 'private';

  v_result := public.reconcile_heygen_core_catalog_snapshot(
    p_organization_id,
    p_sync_run_id,
    p_synced_at,
    p_account_snapshot || jsonb_build_object(
      'catalogScope', 'private',
      'publicCatalogAuthoritative', false
    ),
    p_avatars,
    p_voices
  );

  UPDATE public.heygen_avatar_presets AS preset SET
    is_default = previous.is_default,
    missing_since = previous.missing_since,
    provider_state = previous.provider_state,
    updated_at = previous.updated_at
  FROM jsonb_to_recordset(v_avatar_cache_state) AS previous(
    id uuid,
    is_default boolean,
    missing_since timestamptz,
    provider_state text,
    updated_at timestamptz
  )
  WHERE preset.id = previous.id
    AND preset.organization_id = p_organization_id;

  UPDATE public.heygen_voice_presets AS preset SET
    is_default = previous.is_default,
    missing_since = previous.missing_since,
    provider_state = previous.provider_state,
    updated_at = previous.updated_at
  FROM jsonb_to_recordset(v_voice_cache_state) AS previous(
    id uuid,
    is_default boolean,
    missing_since timestamptz,
    provider_state text,
    updated_at timestamptz
  )
  WHERE preset.id = previous.id
    AND preset.organization_id = p_organization_id;

  SELECT COUNT(*)::integer INTO v_missing_avatars
  FROM public.heygen_avatar_presets
  WHERE organization_id = p_organization_id
    AND ownership = 'private'
    AND provider_state = 'MISSING';

  SELECT COUNT(*)::integer INTO v_missing_voices
  FROM public.heygen_voice_presets
  WHERE organization_id = p_organization_id
    AND ownership = 'private'
    AND provider_state = 'MISSING';

  UPDATE public.heygen_catalog_sync_runs SET
    missing_avatar_count = v_missing_avatars,
    missing_voice_count = v_missing_voices
  WHERE id = p_sync_run_id
    AND organization_id = p_organization_id;

  RETURN v_result || jsonb_build_object(
    'missingAvatarCount', v_missing_avatars,
    'missingVoiceCount', v_missing_voices
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_heygen_private_catalog_snapshot(uuid, uuid, timestamptz, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_heygen_private_catalog_snapshot(uuid, uuid, timestamptz, jsonb, jsonb, jsonb)
  TO service_role;


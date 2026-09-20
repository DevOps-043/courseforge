-- HeyGen's public v3 API does not expose an authoritative collection listing
-- for account assets. Reconcile only the catalogs that can be exhaustively
-- paginated (avatar looks and voices), while preserving locally tracked assets.

CREATE OR REPLACE FUNCTION public.reconcile_heygen_core_catalog_snapshot(
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
  v_asset_count integer := 0;
  v_asset_provider_snapshot jsonb := '[]'::jsonb;
  v_asset_state jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  SELECT
    COUNT(*)::integer,
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'id', id,
        'last_seen_at', last_seen_at,
        'missing_since', missing_since,
        'provider_state', provider_state,
        'updated_at', updated_at
      )),
      '[]'::jsonb
    ),
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'provider_id', heygen_asset_id,
        'name', name,
        'mime_type', mime_type,
        'size_bytes', size_bytes,
        'provider_url', provider_url,
        'status', CASE provider_state
          WHEN 'PROCESSING' THEN 'processing'
          WHEN 'FAILED' THEN 'failed'
          ELSE 'completed'
        END,
        'metadata', metadata
      )) FILTER (WHERE provider_state <> 'MISSING'),
      '[]'::jsonb
    )
  INTO v_asset_count, v_asset_state, v_asset_provider_snapshot
  FROM public.heygen_provider_assets
  WHERE organization_id = p_organization_id;

  v_result := public.reconcile_heygen_catalog_snapshot(
    p_organization_id,
    p_sync_run_id,
    p_synced_at,
    p_account_snapshot || jsonb_build_object('assetsCatalogAuthoritative', false),
    p_avatars,
    p_voices,
    v_asset_provider_snapshot
  );

  -- The legacy reconciler receives the current assets only to avoid declaring
  -- them absent. Restore provider-observation timestamps and states because no
  -- remote asset collection was actually observed during this synchronization.
  UPDATE public.heygen_provider_assets AS asset SET
    last_seen_at = previous.last_seen_at,
    missing_since = previous.missing_since,
    provider_state = previous.provider_state,
    updated_at = previous.updated_at
  FROM jsonb_to_recordset(v_asset_state) AS previous(
    id uuid,
    last_seen_at timestamptz,
    missing_since timestamptz,
    provider_state text,
    updated_at timestamptz
  )
  WHERE asset.id = previous.id
    AND asset.organization_id = p_organization_id;

  UPDATE public.heygen_catalog_sync_runs SET
    asset_count = v_asset_count,
    missing_asset_count = 0
  WHERE id = p_sync_run_id
    AND organization_id = p_organization_id;

  RETURN v_result || jsonb_build_object(
    'assetCount', v_asset_count,
    'missingAssetCount', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_heygen_core_catalog_snapshot(uuid, uuid, timestamptz, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_heygen_core_catalog_snapshot(uuid, uuid, timestamptz, jsonb, jsonb, jsonb)
  TO service_role;


-- Reconcile the organization-scoped HeyGen workspace with authoritative,
-- complete provider snapshots. Local visibility and provider availability are
-- deliberately separate so a locally hidden resource can never mask a remote
-- deletion, and a provider deletion never destroys audit history.

ALTER TABLE public.heygen_workspace_connections
  ADD COLUMN IF NOT EXISTS last_sync_request_id text;

ALTER TABLE public.heygen_workspace_connections
  DROP CONSTRAINT IF EXISTS heygen_workspace_connections_status_check;

ALTER TABLE public.heygen_workspace_connections
  ADD CONSTRAINT heygen_workspace_connections_status_check CHECK (
    last_sync_status IN ('NEVER_SYNCED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')
  );

ALTER TABLE public.heygen_avatar_presets
  ADD COLUMN IF NOT EXISTS provider_state text NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN IF NOT EXISTS ownership text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS missing_since timestamptz;

ALTER TABLE public.heygen_voice_presets
  ADD COLUMN IF NOT EXISTS provider_state text NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN IF NOT EXISTS ownership text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS missing_since timestamptz;

ALTER TABLE public.heygen_avatar_presets
  DROP CONSTRAINT IF EXISTS heygen_avatar_presets_provider_state_check;
ALTER TABLE public.heygen_avatar_presets
  ADD CONSTRAINT heygen_avatar_presets_provider_state_check CHECK (
    provider_state IN ('AVAILABLE', 'PROCESSING', 'FAILED', 'MISSING')
  );

ALTER TABLE public.heygen_voice_presets
  DROP CONSTRAINT IF EXISTS heygen_voice_presets_provider_state_check;
ALTER TABLE public.heygen_voice_presets
  ADD CONSTRAINT heygen_voice_presets_provider_state_check CHECK (
    provider_state IN ('AVAILABLE', 'FAILED', 'MISSING')
  );

CREATE INDEX IF NOT EXISTS heygen_avatar_presets_org_provider_state_idx
  ON public.heygen_avatar_presets (organization_id, provider_state, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS heygen_voice_presets_org_provider_state_idx
  ON public.heygen_voice_presets (organization_id, provider_state, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.heygen_provider_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  heygen_asset_id text NOT NULL,
  name text,
  mime_type text,
  size_bytes bigint,
  provider_url text,
  provider_state text NOT NULL DEFAULT 'AVAILABLE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  missing_since timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT heygen_provider_assets_org_asset_unique UNIQUE (organization_id, heygen_asset_id),
  CONSTRAINT heygen_provider_assets_state_check CHECK (provider_state IN ('AVAILABLE', 'PROCESSING', 'FAILED', 'MISSING')),
  CONSTRAINT heygen_provider_assets_size_check CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS heygen_provider_assets_org_state_idx
  ON public.heygen_provider_assets (organization_id, provider_state, last_seen_at DESC);

ALTER TABLE public.heygen_provider_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_select_heygen_provider_assets" ON public.heygen_provider_assets
  FOR SELECT USING (organization_id::text = public.get_active_org_id());

CREATE TABLE IF NOT EXISTS public.heygen_catalog_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'RUNNING',
  request_id text,
  account_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  avatar_count integer NOT NULL DEFAULT 0,
  voice_count integer NOT NULL DEFAULT 0,
  asset_count integer NOT NULL DEFAULT 0,
  missing_avatar_count integer NOT NULL DEFAULT 0,
  missing_voice_count integer NOT NULL DEFAULT 0,
  missing_asset_count integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT heygen_catalog_sync_runs_status_check CHECK (
    status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS heygen_catalog_sync_runs_one_running_idx
  ON public.heygen_catalog_sync_runs (organization_id) WHERE status = 'RUNNING';
CREATE INDEX IF NOT EXISTS heygen_catalog_sync_runs_org_created_idx
  ON public.heygen_catalog_sync_runs (organization_id, created_at DESC);

ALTER TABLE public.heygen_catalog_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_select_heygen_catalog_sync_runs" ON public.heygen_catalog_sync_runs
  FOR SELECT USING (organization_id::text = public.get_active_org_id());

-- The service role supplies normalized arrays only after every provider cursor
-- has been exhausted. This RPC applies all catalog changes in one transaction.
CREATE OR REPLACE FUNCTION public.reconcile_heygen_catalog_snapshot(
  p_organization_id uuid,
  p_sync_run_id uuid,
  p_synced_at timestamptz,
  p_account_snapshot jsonb,
  p_avatars jsonb,
  p_voices jsonb,
  p_assets jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_missing_avatars integer := 0;
  v_missing_voices integer := 0;
  v_missing_assets integer := 0;
BEGIN
  IF jsonb_typeof(p_avatars) <> 'array'
    OR jsonb_typeof(p_voices) <> 'array'
    OR jsonb_typeof(p_assets) <> 'array' THEN
    RAISE EXCEPTION 'HeyGen catalog snapshot must contain arrays';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.heygen_catalog_sync_runs
    WHERE id = p_sync_run_id AND organization_id = p_organization_id AND status = 'RUNNING'
  ) THEN
    RAISE EXCEPTION 'HeyGen sync run is not active for this organization';
  END IF;

  INSERT INTO public.heygen_avatar_presets (
    organization_id, heygen_avatar_group_id, heygen_avatar_look_id, name,
    avatar_type, default_voice_id, supported_api_engines, preview_image_url,
    preview_video_url, status, ownership, provider_state, metadata,
    last_seen_at, missing_since, synced_at, updated_at
  )
  SELECT p_organization_id, item.group_id, item.provider_id, item.name,
    item.avatar_type, item.default_voice_id, COALESCE(item.supported_api_engines, '[]'::jsonb),
    item.preview_image_url, item.preview_video_url, item.status, item.ownership,
    CASE
      WHEN lower(COALESCE(item.status, 'completed')) = 'processing' THEN 'PROCESSING'
      WHEN lower(COALESCE(item.status, 'completed')) = 'failed' THEN 'FAILED'
      ELSE 'AVAILABLE'
    END,
    COALESCE(item.metadata, '{}'::jsonb), p_synced_at, NULL, p_synced_at, p_synced_at
  FROM jsonb_to_recordset(p_avatars) AS item(
    provider_id text, group_id text, name text, avatar_type text,
    default_voice_id text, supported_api_engines jsonb, preview_image_url text,
    preview_video_url text, status text, ownership text, metadata jsonb
  )
  ON CONFLICT (organization_id, heygen_avatar_look_id) DO UPDATE SET
    heygen_avatar_group_id = EXCLUDED.heygen_avatar_group_id,
    name = EXCLUDED.name, avatar_type = EXCLUDED.avatar_type,
    default_voice_id = EXCLUDED.default_voice_id,
    supported_api_engines = EXCLUDED.supported_api_engines,
    preview_image_url = EXCLUDED.preview_image_url,
    preview_video_url = EXCLUDED.preview_video_url, status = EXCLUDED.status,
    ownership = EXCLUDED.ownership, provider_state = EXCLUDED.provider_state,
    metadata = EXCLUDED.metadata, last_seen_at = p_synced_at,
    missing_since = NULL, synced_at = p_synced_at, updated_at = p_synced_at;

  INSERT INTO public.heygen_voice_presets (
    organization_id, heygen_voice_id, name, language, gender, voice_type,
    preview_audio_url, ownership, provider_state, metadata, last_seen_at,
    missing_since, synced_at, updated_at
  )
  SELECT p_organization_id, item.provider_id, item.name, item.language,
    item.gender, item.voice_type, item.preview_audio_url, item.ownership,
    'AVAILABLE', COALESCE(item.metadata, '{}'::jsonb), p_synced_at, NULL,
    p_synced_at, p_synced_at
  FROM jsonb_to_recordset(p_voices) AS item(
    provider_id text, name text, language text, gender text, voice_type text,
    preview_audio_url text, ownership text, metadata jsonb
  )
  ON CONFLICT (organization_id, heygen_voice_id) DO UPDATE SET
    name = EXCLUDED.name, language = EXCLUDED.language, gender = EXCLUDED.gender,
    voice_type = EXCLUDED.voice_type, preview_audio_url = EXCLUDED.preview_audio_url,
    ownership = EXCLUDED.ownership, provider_state = 'AVAILABLE',
    metadata = EXCLUDED.metadata, last_seen_at = p_synced_at,
    missing_since = NULL, synced_at = p_synced_at, updated_at = p_synced_at;

  INSERT INTO public.heygen_provider_assets (
    organization_id, heygen_asset_id, name, mime_type, size_bytes,
    provider_url, provider_state, metadata, last_seen_at, missing_since, updated_at
  )
  SELECT p_organization_id, item.provider_id, item.name, item.mime_type,
    item.size_bytes, item.provider_url,
    CASE
      WHEN lower(COALESCE(item.status, 'completed')) IN ('failed', 'error') THEN 'FAILED'
      WHEN lower(COALESCE(item.status, 'completed')) IN ('processing', 'pending', 'uploading') THEN 'PROCESSING'
      ELSE 'AVAILABLE'
    END,
    COALESCE(item.metadata, '{}'::jsonb), p_synced_at, NULL, p_synced_at
  FROM jsonb_to_recordset(p_assets) AS item(
    provider_id text, name text, mime_type text, size_bytes bigint,
    provider_url text, status text, metadata jsonb
  )
  ON CONFLICT (organization_id, heygen_asset_id) DO UPDATE SET
    name = EXCLUDED.name, mime_type = EXCLUDED.mime_type,
    size_bytes = EXCLUDED.size_bytes, provider_url = EXCLUDED.provider_url,
    provider_state = EXCLUDED.provider_state, metadata = EXCLUDED.metadata,
    last_seen_at = p_synced_at, missing_since = NULL, updated_at = p_synced_at;

  UPDATE public.heygen_avatar_presets SET
    provider_state = 'MISSING', missing_since = COALESCE(missing_since, p_synced_at),
    is_default = false, updated_at = p_synced_at
  WHERE organization_id = p_organization_id
    AND (last_seen_at IS NULL OR last_seen_at < p_synced_at);
  GET DIAGNOSTICS v_missing_avatars = ROW_COUNT;

  UPDATE public.heygen_voice_presets SET
    provider_state = 'MISSING', missing_since = COALESCE(missing_since, p_synced_at),
    is_default = false, updated_at = p_synced_at
  WHERE organization_id = p_organization_id
    AND (last_seen_at IS NULL OR last_seen_at < p_synced_at);
  GET DIAGNOSTICS v_missing_voices = ROW_COUNT;

  UPDATE public.heygen_provider_assets SET
    provider_state = 'MISSING', missing_since = COALESCE(missing_since, p_synced_at),
    updated_at = p_synced_at
  WHERE organization_id = p_organization_id
    AND (last_seen_at IS NULL OR last_seen_at < p_synced_at);
  GET DIAGNOSTICS v_missing_assets = ROW_COUNT;

  UPDATE public.heygen_workspace_connections SET
    account_label = COALESCE(p_account_snapshot->>'username', account_label),
    metadata = metadata || jsonb_build_object('account', COALESCE(p_account_snapshot, '{}'::jsonb)),
    last_sync_status = 'SUCCEEDED', last_sync_error = NULL,
    last_synced_at = p_synced_at, updated_at = p_synced_at
  WHERE organization_id = p_organization_id;

  UPDATE public.heygen_catalog_sync_runs SET
    status = 'SUCCEEDED', account_snapshot = COALESCE(p_account_snapshot, '{}'::jsonb),
    avatar_count = jsonb_array_length(p_avatars),
    voice_count = jsonb_array_length(p_voices),
    asset_count = jsonb_array_length(p_assets),
    missing_avatar_count = v_missing_avatars,
    missing_voice_count = v_missing_voices,
    missing_asset_count = v_missing_assets,
    completed_at = p_synced_at
  WHERE id = p_sync_run_id;

  RETURN jsonb_build_object(
    'missingAvatarCount', v_missing_avatars,
    'missingVoiceCount', v_missing_voices,
    'missingAssetCount', v_missing_assets
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_heygen_catalog_snapshot(uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_heygen_catalog_snapshot(uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb)
  TO service_role;

COMMENT ON COLUMN public.heygen_avatar_presets.archived_at IS
  'Local visibility preference. It does not represent provider availability.';
COMMENT ON COLUMN public.heygen_voice_presets.archived_at IS
  'Local visibility preference. It does not represent provider availability.';

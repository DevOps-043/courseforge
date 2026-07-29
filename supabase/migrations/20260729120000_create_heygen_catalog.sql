-- ============================================================================
-- Migration: Create HeyGen catalog tables
-- Date: 2026-07-29
-- Description: Stores organization-scoped HeyGen account metadata, avatar
--   presets and voice presets. API keys are not stored here; secrets stay in
--   server-side environment/secret storage and this table keeps only references
--   or non-sensitive metadata.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.heygen_workspace_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  account_label text,
  api_key_secret_ref text,
  api_key_last4 text,
  default_callback_url text,
  webhook_endpoint_id text,
  webhook_secret_ref text,
  last_sync_status text NOT NULL DEFAULT 'NEVER_SYNCED',
  last_sync_error text,
  last_synced_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT heygen_workspace_connections_pkey PRIMARY KEY (id),
  CONSTRAINT heygen_workspace_connections_organization_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT heygen_workspace_connections_org_unique UNIQUE (organization_id),
  CONSTRAINT heygen_workspace_connections_status_check CHECK (
    last_sync_status IN ('NEVER_SYNCED', 'SUCCEEDED', 'FAILED')
  )
);

CREATE TABLE IF NOT EXISTS public.heygen_avatar_presets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  heygen_avatar_group_id text,
  heygen_avatar_look_id text NOT NULL,
  name text NOT NULL,
  avatar_type text,
  default_voice_id text,
  supported_api_engines jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_image_url text,
  preview_video_url text,
  status text,
  is_default boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT heygen_avatar_presets_pkey PRIMARY KEY (id),
  CONSTRAINT heygen_avatar_presets_organization_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT heygen_avatar_presets_org_look_unique
    UNIQUE (organization_id, heygen_avatar_look_id)
);

CREATE TABLE IF NOT EXISTS public.heygen_voice_presets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  heygen_voice_id text NOT NULL,
  name text NOT NULL,
  language text,
  gender text,
  voice_type text,
  preview_audio_url text,
  is_default boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT heygen_voice_presets_pkey PRIMARY KEY (id),
  CONSTRAINT heygen_voice_presets_organization_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT heygen_voice_presets_org_voice_unique
    UNIQUE (organization_id, heygen_voice_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS heygen_avatar_presets_org_default_uidx
  ON public.heygen_avatar_presets (organization_id)
  WHERE is_default = true;

CREATE UNIQUE INDEX IF NOT EXISTS heygen_voice_presets_org_default_uidx
  ON public.heygen_voice_presets (organization_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS heygen_avatar_presets_org_synced_idx
  ON public.heygen_avatar_presets (organization_id, synced_at DESC);

CREATE INDEX IF NOT EXISTS heygen_voice_presets_org_synced_idx
  ON public.heygen_voice_presets (organization_id, synced_at DESC);

ALTER TABLE public.heygen_workspace_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heygen_avatar_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heygen_voice_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_heygen_workspace_connections"
  ON public.heygen_workspace_connections
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_insert_heygen_workspace_connections"
  ON public.heygen_workspace_connections
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_update_heygen_workspace_connections"
  ON public.heygen_workspace_connections
  FOR UPDATE
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_heygen_avatar_presets"
  ON public.heygen_avatar_presets
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_insert_heygen_avatar_presets"
  ON public.heygen_avatar_presets
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_update_heygen_avatar_presets"
  ON public.heygen_avatar_presets
  FOR UPDATE
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_heygen_voice_presets"
  ON public.heygen_voice_presets
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_insert_heygen_voice_presets"
  ON public.heygen_voice_presets
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_update_heygen_voice_presets"
  ON public.heygen_voice_presets
  FOR UPDATE
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

COMMENT ON TABLE public.heygen_workspace_connections IS
  'Organization-scoped HeyGen connection metadata. Does not store plaintext API keys.';

COMMENT ON TABLE public.heygen_avatar_presets IS
  'Synced HeyGen private avatar looks available to an organization.';

COMMENT ON TABLE public.heygen_voice_presets IS
  'Synced HeyGen voices available to an organization.';

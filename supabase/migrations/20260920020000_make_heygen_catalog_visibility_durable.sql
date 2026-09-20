-- Keep provider availability separate from organization-local visibility.
-- A durable exclusion survives preset re-creation during catalog reconciliation.

CREATE TABLE IF NOT EXISTS public.heygen_catalog_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_kind text NOT NULL CHECK (resource_kind IN ('avatar', 'voice')),
  provider_id text NOT NULL,
  excluded_at timestamptz NOT NULL DEFAULT now(),
  excluded_by uuid,
  restored_at timestamptz,
  restored_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT heygen_catalog_exclusions_org_resource_unique
    UNIQUE (organization_id, resource_kind, provider_id)
);

CREATE INDEX IF NOT EXISTS heygen_catalog_exclusions_active_org_idx
  ON public.heygen_catalog_exclusions (organization_id, resource_kind, provider_id)
  WHERE restored_at IS NULL;

ALTER TABLE public.heygen_catalog_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_select_heygen_catalog_exclusions"
  ON public.heygen_catalog_exclusions;
CREATE POLICY "org_select_heygen_catalog_exclusions"
  ON public.heygen_catalog_exclusions
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

-- Preserve existing local archive decisions before switching to durable state.
INSERT INTO public.heygen_catalog_exclusions (
  organization_id,
  resource_kind,
  provider_id,
  excluded_at,
  created_at,
  updated_at
)
SELECT
  organization_id,
  'avatar',
  heygen_avatar_look_id,
  archived_at,
  archived_at,
  archived_at
FROM public.heygen_avatar_presets
WHERE archived_at IS NOT NULL
ON CONFLICT (organization_id, resource_kind, provider_id) DO UPDATE SET
  excluded_at = EXCLUDED.excluded_at,
  restored_at = NULL,
  restored_by = NULL,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.heygen_catalog_exclusions (
  organization_id,
  resource_kind,
  provider_id,
  excluded_at,
  created_at,
  updated_at
)
SELECT
  organization_id,
  'voice',
  heygen_voice_id,
  archived_at,
  archived_at,
  archived_at
FROM public.heygen_voice_presets
WHERE archived_at IS NOT NULL
ON CONFLICT (organization_id, resource_kind, provider_id) DO UPDATE SET
  excluded_at = EXCLUDED.excluded_at,
  restored_at = NULL,
  restored_by = NULL,
  updated_at = EXCLUDED.updated_at;

-- Legacy rows have never been observed by the authoritative private snapshot.
-- Retain them for audit, but do not expose them as selectable provider inventory.
UPDATE public.heygen_avatar_presets
SET
  is_default = false,
  missing_since = COALESCE(missing_since, now()),
  provider_state = 'MISSING',
  updated_at = now()
WHERE ownership IS NULL
  AND provider_state = 'AVAILABLE';

UPDATE public.heygen_voice_presets
SET
  is_default = false,
  missing_since = COALESCE(missing_since, now()),
  provider_state = 'MISSING',
  updated_at = now()
WHERE ownership IS NULL
  AND provider_state = 'AVAILABLE';

CREATE OR REPLACE FUNCTION public.set_heygen_catalog_preset_archived(
  p_organization_id uuid,
  p_resource_kind text,
  p_preset_id uuid,
  p_archived boolean,
  p_actor_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_default boolean;
  v_now timestamptz := now();
  v_provider_id text;
BEGIN
  IF p_resource_kind = 'avatar' THEN
    SELECT heygen_avatar_look_id, is_default
    INTO v_provider_id, v_is_default
    FROM public.heygen_avatar_presets
    WHERE id = p_preset_id
      AND organization_id = p_organization_id
    FOR UPDATE;
  ELSIF p_resource_kind = 'voice' THEN
    SELECT heygen_voice_id, is_default
    INTO v_provider_id, v_is_default
    FROM public.heygen_voice_presets
    WHERE id = p_preset_id
      AND organization_id = p_organization_id
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Unsupported HeyGen catalog resource kind';
  END IF;

  IF v_provider_id IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF p_archived AND v_is_default THEN
    RETURN 'DEFAULT';
  END IF;

  IF p_archived THEN
    INSERT INTO public.heygen_catalog_exclusions (
      organization_id,
      resource_kind,
      provider_id,
      excluded_at,
      excluded_by,
      restored_at,
      restored_by,
      updated_at
    ) VALUES (
      p_organization_id,
      p_resource_kind,
      v_provider_id,
      v_now,
      p_actor_user_id,
      NULL,
      NULL,
      v_now
    )
    ON CONFLICT (organization_id, resource_kind, provider_id) DO UPDATE SET
      excluded_at = EXCLUDED.excluded_at,
      excluded_by = EXCLUDED.excluded_by,
      restored_at = NULL,
      restored_by = NULL,
      updated_at = EXCLUDED.updated_at;
  ELSE
    UPDATE public.heygen_catalog_exclusions
    SET
      restored_at = v_now,
      restored_by = p_actor_user_id,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND resource_kind = p_resource_kind
      AND provider_id = v_provider_id
      AND restored_at IS NULL;
  END IF;

  IF p_resource_kind = 'avatar' THEN
    UPDATE public.heygen_avatar_presets
    SET archived_at = CASE WHEN p_archived THEN v_now ELSE NULL END,
        updated_at = v_now
    WHERE id = p_preset_id
      AND organization_id = p_organization_id;
  ELSE
    UPDATE public.heygen_voice_presets
    SET archived_at = CASE WHEN p_archived THEN v_now ELSE NULL END,
        updated_at = v_now
    WHERE id = p_preset_id
      AND organization_id = p_organization_id;
  END IF;

  RETURN 'UPDATED';
END;
$$;

REVOKE ALL ON FUNCTION public.set_heygen_catalog_preset_archived(uuid, text, uuid, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_heygen_catalog_preset_archived(uuid, text, uuid, boolean, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_heygen_private_catalog_snapshot(
  p_organization_id uuid,
  p_sync_run_id uuid,
  p_synced_at timestamptz,
  p_account_snapshot jsonb,
  p_avatars jsonb,
  p_voices jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avatar_public_state jsonb := '[]'::jsonb;
  v_missing_avatars integer := 0;
  v_missing_voices integer := 0;
  v_result jsonb;
  v_voice_public_state jsonb := '[]'::jsonb;
BEGIN
  -- Public rows are discovery data and are outside the private snapshot.
  -- NULL ownership is legacy private data and must participate in absence detection.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'is_default', is_default,
    'missing_since', missing_since,
    'provider_state', provider_state,
    'updated_at', updated_at
  )), '[]'::jsonb)
  INTO v_avatar_public_state
  FROM public.heygen_avatar_presets
  WHERE organization_id = p_organization_id
    AND ownership = 'public';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'is_default', is_default,
    'missing_since', missing_since,
    'provider_state', provider_state,
    'updated_at', updated_at
  )), '[]'::jsonb)
  INTO v_voice_public_state
  FROM public.heygen_voice_presets
  WHERE organization_id = p_organization_id
    AND ownership = 'public';

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
  FROM jsonb_to_recordset(v_avatar_public_state) AS previous(
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
  FROM jsonb_to_recordset(v_voice_public_state) AS previous(
    id uuid,
    is_default boolean,
    missing_since timestamptz,
    provider_state text,
    updated_at timestamptz
  )
  WHERE preset.id = previous.id
    AND preset.organization_id = p_organization_id;

  -- Reapply active local exclusions after provider upserts. This also handles a
  -- preset row that was physically deleted and then recreated by the snapshot.
  UPDATE public.heygen_avatar_presets AS preset
  SET archived_at = exclusion.excluded_at,
      is_default = false,
      updated_at = GREATEST(preset.updated_at, exclusion.updated_at)
  FROM public.heygen_catalog_exclusions AS exclusion
  WHERE exclusion.organization_id = p_organization_id
    AND exclusion.resource_kind = 'avatar'
    AND exclusion.restored_at IS NULL
    AND preset.organization_id = exclusion.organization_id
    AND preset.heygen_avatar_look_id = exclusion.provider_id;

  UPDATE public.heygen_voice_presets AS preset
  SET archived_at = exclusion.excluded_at,
      is_default = false,
      updated_at = GREATEST(preset.updated_at, exclusion.updated_at)
  FROM public.heygen_catalog_exclusions AS exclusion
  WHERE exclusion.organization_id = p_organization_id
    AND exclusion.resource_kind = 'voice'
    AND exclusion.restored_at IS NULL
    AND preset.organization_id = exclusion.organization_id
    AND preset.heygen_voice_id = exclusion.provider_id;

  SELECT COUNT(*)::integer INTO v_missing_avatars
  FROM public.heygen_avatar_presets
  WHERE organization_id = p_organization_id
    AND ownership IS DISTINCT FROM 'public'
    AND provider_state = 'MISSING';

  SELECT COUNT(*)::integer INTO v_missing_voices
  FROM public.heygen_voice_presets
  WHERE organization_id = p_organization_id
    AND ownership IS DISTINCT FROM 'public'
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

COMMENT ON TABLE public.heygen_catalog_exclusions IS
  'Durable organization-local visibility decisions for synchronized HeyGen presets.';

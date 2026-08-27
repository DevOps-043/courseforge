-- Expands the existing avatar/HyperFrames integration into an organization-scoped
-- HeyGen production platform. Provider secrets remain in the encrypted credential
-- table; this migration stores only settings, correlations and non-sensitive output.

ALTER TABLE public.production_provider_credentials
  DROP CONSTRAINT IF EXISTS production_provider_credentials_provider_check;
ALTER TABLE public.production_provider_credentials
  ADD CONSTRAINT production_provider_credentials_provider_check
  CHECK (provider IN ('heygen', 'heygen_avatar', 'hyperframes_cloud', 'liveavatar'));

CREATE TABLE IF NOT EXISTS public.heygen_workspace_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  monthly_budget_usd numeric(12, 2),
  per_course_budget_usd numeric(12, 2),
  default_locale text NOT NULL DEFAULT 'es-MX',
  default_brand_glossary_id text,
  default_brand_kit_id text,
  liveavatar_avatar_id text,
  liveavatar_context_id text,
  liveavatar_sandbox boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT heygen_workspace_monthly_budget_check CHECK (monthly_budget_usd IS NULL OR monthly_budget_usd >= 0),
  CONSTRAINT heygen_workspace_course_budget_check CHECK (per_course_budget_usd IS NULL OR per_course_budget_usd >= 0)
);

CREATE TABLE IF NOT EXISTS public.heygen_platform_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  artifact_id uuid REFERENCES public.artifacts(id) ON DELETE SET NULL,
  material_component_id uuid REFERENCES public.material_components(id) ON DELETE SET NULL,
  created_by uuid,
  operation_type text NOT NULL,
  title text,
  callback_id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id text,
  provider_status text,
  status text NOT NULL DEFAULT 'PENDING',
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_cost_usd numeric(12, 4),
  actual_cost_usd numeric(12, 4),
  failure_message text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT heygen_platform_operations_callback_unique UNIQUE (callback_id),
  CONSTRAINT heygen_platform_operations_type_check CHECK (operation_type IN (
    'AI_CLIPPING', 'BRAND_GLOSSARY', 'BRAND_KIT', 'FILLER_REMOVAL', 'LIPSYNC',
    'PROOFREAD', 'TEMPLATE_VIDEO', 'VIDEO_AGENT', 'VIDEO_BATCH',
    'VIDEO_TRANSLATION', 'VOICE_CLONE', 'VOICE_DESIGN'
  )),
  CONSTRAINT heygen_platform_operations_status_check CHECK (
    status IN ('PENDING', 'WAITING_PROVIDER', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  )
);

CREATE INDEX IF NOT EXISTS heygen_platform_operations_org_created_idx
  ON public.heygen_platform_operations (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS heygen_platform_operations_artifact_idx
  ON public.heygen_platform_operations (artifact_id, created_at DESC) WHERE artifact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS heygen_platform_operations_provider_idx
  ON public.heygen_platform_operations (provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS heygen_platform_operations_active_idx
  ON public.heygen_platform_operations (organization_id, status)
  WHERE status IN ('PENDING', 'WAITING_PROVIDER');

CREATE TABLE IF NOT EXISTS public.heygen_standalone_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid,
  provider_request_id text,
  title text NOT NULL,
  asset_type text NOT NULL DEFAULT 'VOICE_AUDIO',
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  public_url text NOT NULL,
  mime_type text NOT NULL,
  duration_seconds numeric(12, 3),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT heygen_standalone_assets_org_path_unique UNIQUE (organization_id, storage_bucket, storage_path)
);

ALTER TABLE public.heygen_workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heygen_platform_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heygen_standalone_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_all_heygen_workspace_settings" ON public.heygen_workspace_settings
  FOR ALL USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_select_heygen_platform_operations" ON public.heygen_platform_operations
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_heygen_platform_operations" ON public.heygen_platform_operations
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_heygen_platform_operations" ON public.heygen_platform_operations
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_select_heygen_standalone_assets" ON public.heygen_standalone_assets
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_heygen_standalone_assets" ON public.heygen_standalone_assets
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());

ALTER TABLE private.heygen_webhook_events
  ADD COLUMN IF NOT EXISTS platform_operation_id uuid
  REFERENCES public.heygen_platform_operations(id) ON DELETE SET NULL;

-- One organization owns one signed endpoint. Both avatar and HyperFrames use it,
-- so rotating either credential replaces a single endpoint instead of creating
-- duplicate deliveries for the same account.
CREATE OR REPLACE FUNCTION public.configure_heygen_webhook(
  p_organization_id uuid,
  p_endpoint_id text,
  p_callback_url text,
  p_encrypted_secret text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private
AS $$
BEGIN
  IF p_endpoint_id IS NULL OR trim(p_endpoint_id) = ''
    OR p_callback_url !~ '^https://'
    OR p_encrypted_secret IS NULL OR trim(p_encrypted_secret) = '' THEN
    RAISE EXCEPTION 'invalid HeyGen webhook configuration';
  END IF;
  INSERT INTO public.heygen_workspace_connections (
    organization_id, default_callback_url, webhook_endpoint_id
  ) VALUES (p_organization_id, p_callback_url, p_endpoint_id)
  ON CONFLICT (organization_id) DO UPDATE SET
    default_callback_url = EXCLUDED.default_callback_url,
    webhook_endpoint_id = EXCLUDED.webhook_endpoint_id,
    updated_at = now();
  INSERT INTO public.hyperframes_workspace_connections (
    organization_id, default_callback_url, webhook_endpoint_id
  ) VALUES (p_organization_id, p_callback_url, p_endpoint_id)
  ON CONFLICT (organization_id) DO UPDATE SET
    default_callback_url = EXCLUDED.default_callback_url,
    webhook_endpoint_id = EXCLUDED.webhook_endpoint_id,
    updated_at = now();
  INSERT INTO private.heygen_webhook_secrets (
    organization_id, endpoint_id, callback_url, encrypted_secret
  ) VALUES (p_organization_id, p_endpoint_id, p_callback_url, p_encrypted_secret)
  ON CONFLICT (organization_id) DO UPDATE SET
    endpoint_id = EXCLUDED.endpoint_id,
    callback_url = EXCLUDED.callback_url,
    encrypted_secret = EXCLUDED.encrypted_secret,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_heygen_webhook(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private
AS $$
BEGIN
  UPDATE public.heygen_workspace_connections SET
    default_callback_url = NULL, webhook_endpoint_id = NULL, updated_at = now()
  WHERE organization_id = p_organization_id;
  UPDATE public.hyperframes_workspace_connections SET
    default_callback_url = NULL, webhook_endpoint_id = NULL, updated_at = now()
  WHERE organization_id = p_organization_id;
  DELETE FROM private.heygen_webhook_secrets WHERE organization_id = p_organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_heygen_webhook(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_heygen_webhook(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_heygen_webhook(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_heygen_webhook(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_heygen_webhook_verification_context(p_callback_id text)
RETURNS TABLE (organization_id uuid, encrypted_secret text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private, extensions
AS $$
  SELECT candidates.organization_id, candidates.encrypted_secret FROM (
    SELECT request.organization_id, secret.encrypted_secret, 1 AS priority
    FROM public.hyperframes_render_requests request
    JOIN private.heygen_webhook_secrets secret ON secret.organization_id = request.organization_id
    WHERE request.callback_id = p_callback_id
    UNION ALL
    SELECT operation.organization_id, secret.encrypted_secret, 2 AS priority
    FROM public.heygen_platform_operations operation
    JOIN private.heygen_webhook_secrets secret ON secret.organization_id = operation.organization_id
    WHERE operation.callback_id::text = p_callback_id
  ) candidates ORDER BY priority LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_heygen_webhook_verification_context(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_heygen_webhook_verification_context(text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_heygen_platform_webhook_event(
  p_event_id text,
  p_event_type text,
  p_callback_id text,
  p_provider_id text,
  p_payload_sha256 text,
  p_event_data jsonb,
  p_failure_message text DEFAULT NULL
)
RETURNS TABLE (duplicate boolean, operation_id uuid, organization_id uuid, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, extensions
AS $$
DECLARE
  v_operation public.heygen_platform_operations%ROWTYPE;
  v_inserted integer;
  v_success boolean := right(p_event_type, 8) = '.success';
  v_failure boolean := right(p_event_type, 5) = '.fail';
BEGIN
  SELECT * INTO v_operation FROM public.heygen_platform_operations
  WHERE callback_id::text = p_callback_id FOR UPDATE;
  IF v_operation.id IS NULL THEN RAISE EXCEPTION 'unknown platform callback'; END IF;
  IF v_operation.provider_id IS NOT NULL AND p_provider_id <> ''
     AND v_operation.provider_id IS DISTINCT FROM p_provider_id
     AND NOT (COALESCE(v_operation.output_snapshot->'provider_ids', '[]'::jsonb) ? p_provider_id) THEN
    RAISE EXCEPTION 'platform webhook correlation failed';
  END IF;

  INSERT INTO private.heygen_webhook_events (
    event_id, platform_operation_id, event_type, payload_sha256, outcome
  ) VALUES (
    left(p_event_id, 255), v_operation.id, left(p_event_type, 120), p_payload_sha256, 'RECEIVED'
  ) ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN QUERY SELECT true, v_operation.id, v_operation.organization_id, 'DUPLICATE'::text;
    RETURN;
  END IF;

  UPDATE public.heygen_platform_operations SET
    provider_id = COALESCE(provider_id, NULLIF(p_provider_id, '')),
    provider_status = p_event_type,
    status = CASE WHEN v_success THEN 'SUCCEEDED' WHEN v_failure THEN 'FAILED' ELSE status END,
    failure_message = CASE WHEN v_failure THEN left(COALESCE(p_failure_message, 'HeyGen reported a failed operation.'), 1000) ELSE failure_message END,
    output_snapshot = COALESCE(output_snapshot, '{}'::jsonb) || COALESCE(p_event_data, '{}'::jsonb),
    completed_at = CASE WHEN v_success OR v_failure THEN now() ELSE completed_at END,
    updated_at = now()
  WHERE id = v_operation.id;

  UPDATE private.heygen_webhook_events SET outcome = 'PROCESSED', processed_at = now()
  WHERE event_id = p_event_id;
  RETURN QUERY SELECT false, v_operation.id, v_operation.organization_id,
    CASE WHEN v_success THEN 'SUCCEEDED' WHEN v_failure THEN 'FAILED' ELSE 'UPDATED' END;
END;
$$;
REVOKE ALL ON FUNCTION public.record_heygen_platform_webhook_event(text, text, text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_heygen_platform_webhook_event(text, text, text, text, text, jsonb, text)
  TO service_role;

COMMENT ON TABLE public.heygen_platform_operations IS
  'Auditable organization-scoped jobs for HeyGen v3 features outside direct avatar and HyperFrames rendering.';
COMMENT ON TABLE public.heygen_standalone_assets IS
  'Durable library entries for HeyGen audio generated outside a material component.';

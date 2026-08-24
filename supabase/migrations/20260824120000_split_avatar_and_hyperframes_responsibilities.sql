-- Separate the two production capabilities even when both are supplied by HeyGen.
-- Existing credentials are copied, never moved, so the rollout has no render outage.

ALTER TABLE public.production_provider_credentials
  DROP CONSTRAINT IF EXISTS production_provider_credentials_provider_check;

ALTER TABLE public.production_provider_credentials
  ADD CONSTRAINT production_provider_credentials_provider_check
  CHECK (provider IN ('heygen', 'heygen_avatar', 'hyperframes_cloud'));

INSERT INTO public.production_provider_credentials (
  organization_id, provider, encrypted_secret, secret_last4, status,
  validation_status, last_validated_at, last_validation_error, created_by,
  created_at, updated_at, revoked_at, metadata
)
SELECT organization_id, 'heygen_avatar', encrypted_secret, secret_last4, status,
  validation_status, last_validated_at, last_validation_error, created_by,
  created_at, now(), revoked_at, metadata || jsonb_build_object('migrated_from', 'heygen')
FROM public.production_provider_credentials
WHERE provider = 'heygen' AND status = 'ACTIVE'
ON CONFLICT DO NOTHING;

INSERT INTO public.production_provider_credentials (
  organization_id, provider, encrypted_secret, secret_last4, status,
  validation_status, last_validated_at, last_validation_error, created_by,
  created_at, updated_at, revoked_at, metadata
)
SELECT organization_id, 'hyperframes_cloud', encrypted_secret, secret_last4, status,
  validation_status, last_validated_at, last_validation_error, created_by,
  created_at, now(), revoked_at, metadata || jsonb_build_object('migrated_from', 'heygen')
FROM public.production_provider_credentials
WHERE provider = 'heygen' AND status = 'ACTIVE'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.hyperframes_workspace_connections (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  default_callback_url text,
  webhook_endpoint_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.hyperframes_workspace_connections (
  organization_id, default_callback_url, webhook_endpoint_id, created_at, updated_at
)
SELECT organization_id, default_callback_url, webhook_endpoint_id, created_at, updated_at
FROM public.heygen_workspace_connections
WHERE webhook_endpoint_id IS NOT NULL OR default_callback_url IS NOT NULL
ON CONFLICT (organization_id) DO NOTHING;

ALTER TABLE public.hyperframes_workspace_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_select_hyperframes_workspace_connections"
  ON public.hyperframes_workspace_connections FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE OR REPLACE FUNCTION public.configure_hyperframes_webhook(
  p_organization_id uuid,
  p_endpoint_id text,
  p_callback_url text,
  p_encrypted_secret text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private
AS $$
BEGIN
  INSERT INTO public.hyperframes_workspace_connections (organization_id, default_callback_url, webhook_endpoint_id)
  VALUES (p_organization_id, p_callback_url, p_endpoint_id)
  ON CONFLICT (organization_id) DO UPDATE SET
    default_callback_url = EXCLUDED.default_callback_url,
    webhook_endpoint_id = EXCLUDED.webhook_endpoint_id,
    updated_at = now();
  INSERT INTO private.heygen_webhook_secrets (organization_id, endpoint_id, callback_url, encrypted_secret)
  VALUES (p_organization_id, p_endpoint_id, p_callback_url, p_encrypted_secret)
  ON CONFLICT (organization_id) DO UPDATE SET endpoint_id = EXCLUDED.endpoint_id,
    callback_url = EXCLUDED.callback_url, encrypted_secret = EXCLUDED.encrypted_secret, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_hyperframes_webhook(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private
AS $$
BEGIN
  UPDATE public.hyperframes_workspace_connections
  SET default_callback_url = NULL, webhook_endpoint_id = NULL, updated_at = now()
  WHERE organization_id = p_organization_id;
  DELETE FROM private.heygen_webhook_secrets WHERE organization_id = p_organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_hyperframes_webhook(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_hyperframes_webhook(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_hyperframes_webhook(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_hyperframes_webhook(uuid) TO service_role;

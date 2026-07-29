-- ============================================================================
-- Migration: Production provider credentials
-- Date: 2026-07-29
-- Description: Stores organization-scoped external provider credentials as
--   encrypted secrets. Plaintext secrets must never be persisted or exposed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.production_provider_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  provider text NOT NULL,
  encrypted_secret text NOT NULL,
  secret_last4 text,
  status text NOT NULL DEFAULT 'ACTIVE',
  validation_status text NOT NULL DEFAULT 'NEVER_VALIDATED',
  last_validated_at timestamp with time zone,
  last_validation_error text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT production_provider_credentials_pkey PRIMARY KEY (id),
  CONSTRAINT production_provider_credentials_organization_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT production_provider_credentials_provider_check
    CHECK (provider IN ('heygen')),
  CONSTRAINT production_provider_credentials_status_check
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT production_provider_credentials_validation_status_check
    CHECK (validation_status IN ('NEVER_VALIDATED', 'VALID', 'INVALID')),
  CONSTRAINT production_provider_credentials_last4_check
    CHECK (secret_last4 IS NULL OR char_length(secret_last4) <= 8)
);

CREATE UNIQUE INDEX IF NOT EXISTS production_provider_credentials_org_provider_active_uidx
  ON public.production_provider_credentials (organization_id, provider)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS production_provider_credentials_org_provider_status_idx
  ON public.production_provider_credentials (organization_id, provider, status);

ALTER TABLE public.production_provider_credentials ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.production_provider_credentials IS
  'Organization-scoped encrypted credentials for production providers. Never stores plaintext secrets.';

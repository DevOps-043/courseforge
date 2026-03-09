-- Migration: Add organization_id to system_prompts and model_settings
-- Purpose: Enable per-organization AI configuration isolation

-- ============================================================
-- 1. SYSTEM PROMPTS — Add organization_id
-- ============================================================

ALTER TABLE public.system_prompts
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_system_prompts_org
  ON public.system_prompts (organization_id);

-- Drop old unique constraint (code, version) and replace with org-aware one
ALTER TABLE public.system_prompts
  DROP CONSTRAINT IF EXISTS system_prompts_code_version_key;

ALTER TABLE public.system_prompts
  ADD CONSTRAINT system_prompts_code_version_org_key UNIQUE (code, version, organization_id);

-- Update RLS policies for system_prompts
DROP POLICY IF EXISTS "Enable read access for all users" ON public.system_prompts;
DROP POLICY IF EXISTS "Enable insert/update for admins only" ON public.system_prompts;

-- Allow users to read prompts from their own org OR global (org_id IS NULL)
CREATE POLICY "Users can view own org prompts"
  ON public.system_prompts
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'active_organization_id',
      (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'active_organization_id')
    )
  );

-- Allow users to insert/update prompts in their own org only
CREATE POLICY "Users can manage own org prompts"
  ON public.system_prompts
  FOR ALL
  USING (
    organization_id IS NULL
    OR organization_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'active_organization_id',
      (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'active_organization_id')
    )
  )
  WITH CHECK (
    organization_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'active_organization_id',
      (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'active_organization_id')
    )
  );


-- ============================================================
-- 2. MODEL SETTINGS — Add organization_id
-- ============================================================

ALTER TABLE public.model_settings
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_model_settings_org
  ON public.model_settings (organization_id);

-- Enable RLS on model_settings (may not have been enabled before)
ALTER TABLE public.model_settings ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS "Allow all access to model_settings" ON public.model_settings;

-- Allow users to read settings from their own org OR global
CREATE POLICY "Users can view own org model settings"
  ON public.model_settings
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'active_organization_id',
      (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'active_organization_id')
    )
  );

-- Allow users to update settings in their own org only
CREATE POLICY "Users can manage own org model settings"
  ON public.model_settings
  FOR ALL
  USING (
    organization_id IS NULL
    OR organization_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'active_organization_id',
      (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'active_organization_id')
    )
  )
  WITH CHECK (
    organization_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'active_organization_id',
      (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'active_organization_id')
    )
  );


-- ============================================================
-- 3. SEED: Assign existing global rows to the first organization
-- ============================================================
-- This ensures current data is not orphaned.
-- Run this manually or adjust the org ID as needed.

-- UPDATE public.system_prompts
--   SET organization_id = (SELECT id FROM public.organizations LIMIT 1)
--   WHERE organization_id IS NULL;

-- UPDATE public.model_settings
--   SET organization_id = (SELECT id FROM public.organizations LIMIT 1)
--   WHERE organization_id IS NULL;

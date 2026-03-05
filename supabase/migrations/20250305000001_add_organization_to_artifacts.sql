-- Migration: Add organization_id to artifacts table
-- Purpose: Enable multi-tenant content isolation in CourseForge
-- 
-- This column links each artifact (course/workshop) to the organization
-- that generated it. The organization_id corresponds to the UUID from
-- SofLIA's organizations table (synced via shared JWT context).

-- Step 1: Add the column (nullable for existing rows)
ALTER TABLE public.artifacts 
  ADD COLUMN IF NOT EXISTS organization_id uuid;

-- Step 2: Create an index for fast lookups by organization
CREATE INDEX IF NOT EXISTS idx_artifacts_organization_id 
  ON public.artifacts (organization_id);

-- Step 3: Add RLS policies for multi-tenant isolation
-- Users can only see artifacts from their active organization
-- The organization_id is read from the JWT custom claims

-- Drop existing policies if they conflict
DROP POLICY IF EXISTS "Users can view own organization artifacts" ON public.artifacts;
DROP POLICY IF EXISTS "Users can insert artifacts in own organization" ON public.artifacts;
DROP POLICY IF EXISTS "Users can update own organization artifacts" ON public.artifacts;

-- Policy: SELECT - Users see only their organization's artifacts
CREATE POLICY "Users can view own organization artifacts" 
  ON public.artifacts 
  FOR SELECT 
  USING (
    organization_id IS NULL -- Backward compatibility: old artifacts without org
    OR organization_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'active_organization_id',
      (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'active_organization_id')
    )
  );

-- Policy: INSERT - Users can only create artifacts for their active organization
CREATE POLICY "Users can insert artifacts in own organization" 
  ON public.artifacts 
  FOR INSERT 
  WITH CHECK (
    organization_id IS NULL
    OR organization_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'active_organization_id',
      (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'active_organization_id')
    )
  );

-- Policy: UPDATE - Users can only update artifacts in their organization
CREATE POLICY "Users can update own organization artifacts" 
  ON public.artifacts 
  FOR UPDATE 
  USING (
    organization_id IS NULL
    OR organization_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'active_organization_id',
      (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'active_organization_id')
    )
  );

-- Step 4: Ensure RLS is enabled on artifacts table
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;

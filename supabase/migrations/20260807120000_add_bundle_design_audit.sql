-- ============================================================================
-- Migration: Persist Bundle Agent design and similarity audit data
-- Date: 2026-08-07
-- Description:
--   Adds additive JSONB audit columns to generation runs. Existing records keep
--   empty object defaults and remain readable; new video bundle runs persist the
--   resolved safe design plan, visual fingerprint and similarity decision.
-- ============================================================================

ALTER TABLE public.soflia_bundle_generation_runs
  ADD COLUMN IF NOT EXISTS design_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS visual_fingerprint jsonb,
  ADD COLUMN IF NOT EXISTS similarity_guard_result jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The workflow compares the most recent tenant-scoped fingerprints. A partial
-- btree index supports that bounded ordered query without indexing slide runs.
CREATE INDEX IF NOT EXISTS idx_soflia_bundle_runs_org_fingerprint_recent
  ON public.soflia_bundle_generation_runs (organization_id, created_at DESC)
  WHERE visual_fingerprint IS NOT NULL;

COMMENT ON COLUMN public.soflia_bundle_generation_runs.design_plan IS
  'Resolved bounded design plan compiled into a video bundle; no executable code.';

COMMENT ON COLUMN public.soflia_bundle_generation_runs.visual_fingerprint IS
  'Normalized visual traits used to detect duplicate bundle compositions within an organization.';

COMMENT ON COLUMN public.soflia_bundle_generation_runs.similarity_guard_result IS
  'Deterministic allow/review/block result and explainable trait matches for the generation run.';

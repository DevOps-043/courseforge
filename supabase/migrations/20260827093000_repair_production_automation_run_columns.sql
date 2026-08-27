-- Some development databases received the initial production run tables before
-- the configuration fields were introduced. CREATE TABLE IF NOT EXISTS cannot
-- repair that situation, so keep this forward migration intentionally narrow.

ALTER TABLE public.production_runs
  ADD COLUMN IF NOT EXISTS configuration jsonb NOT NULL
    DEFAULT '{"approval_state":"DRAFT","render_mode":"MANUAL_ONLY","version":1}'::jsonb;

ALTER TABLE public.production_run_items
  ADD COLUMN IF NOT EXISTS configuration jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.production_run_items
  ADD COLUMN IF NOT EXISTS requirements jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.production_run_items
  ADD COLUMN IF NOT EXISTS readiness jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.production_run_items
  ADD COLUMN IF NOT EXISTS dispatch_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.production_run_items
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

ALTER TABLE public.production_run_items
  ADD COLUMN IF NOT EXISTS ready_for_assembly_at timestamptz;

ALTER TABLE public.production_run_items
  ADD COLUMN IF NOT EXISTS editor_opened_at timestamptz;

-- Add upstream_dirty tracking columns to steps 3-7
-- When a user edits content in a previous step, downstream steps are marked dirty

-- Step 3: Instructional Plans
ALTER TABLE public.instructional_plans
ADD COLUMN upstream_dirty boolean DEFAULT false,
ADD COLUMN upstream_dirty_source text;

-- Step 4: Curation
ALTER TABLE public.curation
ADD COLUMN upstream_dirty boolean DEFAULT false,
ADD COLUMN upstream_dirty_source text;

-- Step 5: Materials
ALTER TABLE public.materials
ADD COLUMN upstream_dirty boolean DEFAULT false,
ADD COLUMN upstream_dirty_source text;

-- Step 7: Publication Requests
ALTER TABLE public.publication_requests
ADD COLUMN upstream_dirty boolean DEFAULT false,
ADD COLUMN upstream_dirty_source text;

-- Comments
COMMENT ON COLUMN public.instructional_plans.upstream_dirty IS 'True when a previous step (e.g. Temario) was modified after this plan was generated.';
COMMENT ON COLUMN public.curation.upstream_dirty IS 'True when a previous step was modified after curation was completed.';
COMMENT ON COLUMN public.materials.upstream_dirty IS 'True when a previous step was modified after materials were generated.';
COMMENT ON COLUMN public.publication_requests.upstream_dirty IS 'True when a previous step was modified after publication was configured.';

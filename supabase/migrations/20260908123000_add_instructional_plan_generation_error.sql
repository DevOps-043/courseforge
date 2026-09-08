ALTER TABLE public.instructional_plans
  ADD COLUMN IF NOT EXISTS last_error jsonb;

COMMENT ON COLUMN public.instructional_plans.last_error IS
  'Sanitized diagnostic for the latest instructional-plan generation or dispatch failure.';

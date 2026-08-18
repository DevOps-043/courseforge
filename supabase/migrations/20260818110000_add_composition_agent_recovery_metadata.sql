-- Recovery is bounded in application code and recorded separately from the
-- immutable semantic proposal envelope for operational auditability.
UPDATE public.video_composition_generation_settings
SET fallback_model = NULL,
    updated_at = now()
WHERE fallback_model = agent_model;

ALTER TABLE public.video_composition_generation_settings
  DROP CONSTRAINT IF EXISTS video_composition_generation_settings_distinct_fallback;
ALTER TABLE public.video_composition_generation_settings
  ADD CONSTRAINT video_composition_generation_settings_distinct_fallback
  CHECK (fallback_model IS NULL OR fallback_model <> agent_model);

ALTER TABLE public.video_composition_agent_proposals
  ADD COLUMN IF NOT EXISTS recovery_attempt_count smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recovery_repaired boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recovery_used_fallback boolean NOT NULL DEFAULT false;

ALTER TABLE public.video_composition_agent_proposals
  DROP CONSTRAINT IF EXISTS video_composition_agent_proposals_recovery_attempts_check;
ALTER TABLE public.video_composition_agent_proposals
  ADD CONSTRAINT video_composition_agent_proposals_recovery_attempts_check
  CHECK (recovery_attempt_count BETWEEN 1 AND 3);

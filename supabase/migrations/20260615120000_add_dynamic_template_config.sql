-- ============================================================================
-- Migration: Add dynamic Remotion template configuration
-- Date: 2026-06-15
-- Description:
--   Supports safe dynamic presets for internal Remotion compositions and tracks
--   uploaded external ZIP references without executing them.
-- ============================================================================

ALTER TABLE public.remotion_templates
  ADD COLUMN IF NOT EXISTS default_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS bundle_status text NOT NULL DEFAULT 'NOT_APPLICABLE';

ALTER TABLE public.remotion_templates
  DROP CONSTRAINT IF EXISTS remotion_templates_bundle_status_check;

ALTER TABLE public.remotion_templates
  ADD CONSTRAINT remotion_templates_bundle_status_check
  CHECK (
    bundle_status IN (
      'NOT_APPLICABLE',
      'STORED_REFERENCE',
      'PENDING_REVIEW',
      'APPROVED',
      'REJECTED'
    )
  );

UPDATE public.remotion_templates
SET bundle_status = CASE
  WHEN storage_path IS NULL OR storage_path = '' THEN 'NOT_APPLICABLE'
  ELSE 'STORED_REFERENCE'
END
WHERE bundle_status = 'NOT_APPLICABLE';

COMMENT ON COLUMN public.remotion_templates.default_config IS
  'Validated dynamic render preset applied to the internal Remotion composition.';

COMMENT ON COLUMN public.remotion_templates.bundle_status IS
  'Lifecycle for uploaded external bundle references. External bundles are not executed unless explicitly approved by a future sandboxed renderer.';

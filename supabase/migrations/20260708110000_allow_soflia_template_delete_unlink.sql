-- ============================================================================
-- Migration: Allow deleting templates linked to SofLIA conversations
-- Date: 2026-07-08
-- Description:
--   SofLIA conversations keep a single primary template and must not be
--   reassigned to another template. The FK to remotion_templates uses
--   ON DELETE SET NULL, so deleting a template legitimately clears template_id.
--   This replacement preserves the no-reassignment guard while allowing that
--   delete cleanup to complete.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_soflia_bundle_template_reassignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.template_id IS NOT NULL
     AND NEW.template_id IS NOT NULL
     AND NEW.template_id IS DISTINCT FROM OLD.template_id THEN
    RAISE EXCEPTION 'SofLIA bundle conversation template_id cannot be reassigned';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_soflia_bundle_template_reassignment() IS
  'Prevents changing a SofLIA bundle conversation to a different template while allowing ON DELETE SET NULL when the template is deleted.';
